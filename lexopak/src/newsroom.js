import { config } from "./config.js";
import { draftFromLead } from "./ai.js";
import { pollAll, sourceName } from "./sources.js";
import { uniqueSlug } from "./util.js";

// Drafts are made one at a time so a burst of new stories doesn't fire dozens of API calls at once.
export function createNewsroom(repo, { draft = draftFromLead, log = console } = {}) {
  const queue = [];
  let running = false;

  async function work() {
    if (running) return;
    running = true;
    while (queue.length) {
      const id = queue.shift();
      const lead = repo.getLead(id);
      if (!lead || lead.status !== "drafting") continue;
      try {
        const d = await draft(lead);
        // The outlet that broke the story is always credited.
        if (!d.sources.some((s) => s.url === lead.url)) d.sources.unshift({ name: sourceName(lead.source), url: lead.url });
        repo.createArticle({ ...d, leadId: lead.id, slug: uniqueSlug(d.title, repo.slugExists) });
        log.info(`[newsroom] drafted lead ${id}: ${d.title}`);
      } catch (err) {
        repo.setLeadStatus(id, "failed", err.message);
        log.error(`[newsroom] lead ${id} failed: ${err.message}`);
      }
    }
    running = false;
  }

  function enqueue(id) {
    repo.setLeadStatus(id, "drafting");
    queue.push(id);
    return work();
  }

  async function poll() {
    try {
      const newIds = await pollAll(repo);
      if (newIds.length) log.info(`[newsroom] ${newIds.length} new leads`);
      if (config.autoDraft) newIds.forEach((id) => enqueue(id));
      return newIds;
    } catch (err) {
      log.error(`[newsroom] poll failed: ${err.message}`);
      return [];
    }
  }

  function start() {
    repo.resetStuckLeads();
    poll();
    return setInterval(poll, config.pollMinutes * 60_000);
  }

  return { enqueue, poll, start, isBusy: () => running, queueLength: () => queue.length };
}
