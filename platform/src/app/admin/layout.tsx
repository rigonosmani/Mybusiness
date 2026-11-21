import { ProfileProvider } from "@/components/providers";
import { AdminNav } from "@/components/admin/nav";
import { requireArea } from "@/lib/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireArea("admin");
  return <ProfileProvider profile={profile}><AdminNav>{children}</AdminNav></ProfileProvider>;
}
