import { ProfileProvider } from "@/components/providers";
import { PlayerShell } from "@/components/shell/player-shell";
import { requireArea } from "@/lib/session";

export default async function PlayerLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireArea("player");
  return (
    <ProfileProvider profile={profile}>
      <PlayerShell>{children}</PlayerShell>
    </ProfileProvider>
  );
}
