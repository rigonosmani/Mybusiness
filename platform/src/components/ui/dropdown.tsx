"use client";
import * as M from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Dropdown({ trigger, children, align = "end" }: { trigger: ReactNode; children: ReactNode; align?: "start" | "end" }) {
  return (
    <M.Root>
      <M.Trigger asChild>{trigger}</M.Trigger>
      <M.Portal>
        <M.Content align={align} sideOffset={6} className="z-50 min-w-[12rem] rounded-md border border-border bg-panel p-1 shadow-xl data-[state=open]:animate-fade-in">
          {children}
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}

export function DropdownItem({ children, onSelect, danger, disabled }: { children: ReactNode; onSelect?: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <M.Item disabled={disabled} onSelect={onSelect}
      className={cn("flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-panel-3 data-[disabled]:opacity-40 [&_svg]:size-4",
        danger && "text-danger")}>
      {children}
    </M.Item>
  );
}
export const DropdownSeparator = () => <M.Separator className="my-1 h-px bg-border" />;
