"use client";
import { useRouter } from "next/navigation";
import { ChevronDown, KeyRound, LogOut, ShieldCheck, User } from "lucide-react";
import { useState } from "react";
import { PasswordDialog } from "@/components/admin/dialogs";
import { useAction } from "@/hooks/use-action";
import { Dropdown, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
import { useProfile } from "@/components/providers";
import { useI18n } from "@/lib/i18n";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useBetSlip } from "@/stores/betslip";

export function UserMenu() {
  const p = useProfile();
  const { t } = useI18n();
  const router = useRouter();
  const clear = useBetSlip((s) => s.clear);
  const [pwOpen, setPwOpen] = useState(false);
  const changePw = useAction(async (pw: string) => {
    if (pw.length < 10) throw new Error("PASSWORD_LENGTH");
    if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) throw new Error("PASSWORD_COMPLEXITY");
    const { error } = await supabaseBrowser().auth.updateUser({ password: pw });
    if (error) throw error;
  }, { success: t.profile.passwordChanged, onSuccess: () => setPwOpen(false) });
  async function logout() {
    await supabaseBrowser().auth.signOut();
    clear();
    router.replace("/login");
    router.refresh();
  }
  return (
    <>
    <PasswordDialog open={pwOpen} onOpenChange={setPwOpen} title={t.profile.changePassword} pending={changePw.pending} onSubmit={(pw) => changePw.run(pw)} />
    <Dropdown trigger={
      <button className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-panel-3" aria-label={t.nav.profile}>
        <span className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-sm font-bold text-black">
          {p.display_name.slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden text-sm font-medium md:inline">{p.username}</span>
        <ChevronDown className="hidden size-4 text-muted-foreground sm:block" />
      </button>
    }>
      <div className="px-2 py-1.5 text-xs text-muted-foreground">{p.display_name}</div>
      <DropdownSeparator />
      {p.role === "player" && <DropdownItem onSelect={() => router.push("/profile")}><User /> {t.nav.profile}</DropdownItem>}
      {p.role !== "player" && (<>
        <DropdownItem onSelect={() => setPwOpen(true)}><KeyRound /> {t.profile.changePassword}</DropdownItem>
        <DropdownItem onSelect={() => router.push("/mfa")}><ShieldCheck /> {t.nav.mfa}</DropdownItem>
      </>)}
      <DropdownSeparator />
      <DropdownItem onSelect={logout} danger><LogOut /> {t.nav.logout}</DropdownItem>
    </Dropdown>
    </>
  );
}
