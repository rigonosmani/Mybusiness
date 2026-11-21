import { ProfileProvider } from "@/components/providers";
import { SuperNav } from "@/components/admin/super-nav";
import { requireArea } from "@/lib/session";

export default async function SuperLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireArea("super_admin");
  return <ProfileProvider profile={profile}><SuperNav>{children}</SuperNav></ProfileProvider>;
}
