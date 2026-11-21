"use client";
import * as S from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export function Switch({ checked, onCheckedChange, disabled, label }: { checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <S.Root aria-label={label} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled}
      className={cn("relative h-6 w-11 shrink-0 rounded-full bg-panel-3 transition data-[state=checked]:bg-primary disabled:opacity-50")}>
      <S.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow transition data-[state=checked]:translate-x-[22px]" />
    </S.Root>
  );
}
