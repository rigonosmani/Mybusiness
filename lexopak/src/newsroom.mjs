import { config } from "./config.mjs";
import { draftFromLead } from "./ai.mjs";
import { pollAll, sourceName } from "./sources.mjs";
import { uniqueSlug } from "./util.mjs";

// Drafts are made one at a time so a burst of new stories doesn't fire dozens of API calls at once.
export function createNewsroom(repo, { draft = draftFromLead, log = console } = {}) {
  const queue = [];
  let current = null;

  async function run() {
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
  }

  // Resolves when the queue is empty.
  function work() {
    current ||= run().finally(() => {
      current = null;
      if (queue.length) work();
    });
    return current;
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
    repo.failStuckLeads();
    if (!config.pollMinutes) return null;
    poll();
    return setInterval(poll, config.pollMinutes * 60_000);
  }

  return { enqueue, poll, start, drain: () => current || Promise.resolve(), isBusy: () => !!current, queueLength: () => queue.length };
}
