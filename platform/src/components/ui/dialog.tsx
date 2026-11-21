"use client";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Dialog({ open, onOpenChange, title, description, children, className }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; description?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-fade-in" />
        <D.Content className={cn("fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-panel p-5 shadow-2xl data-[state=open]:animate-fade-in", className)}>
          <div className="mb-4 pr-8">
            <D.Title className="text-lg font-semibold">{title}</D.Title>
            {description ? <D.Description className="mt-1 text-sm text-muted-foreground">{description}</D.Description> : <D.Description className="sr-only">{String(title)}</D.Description>}
          </div>
          {children}
          <D.Close className="absolute right-4 top-4 rounded-sm p-1 text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="size-4" />
          </D.Close>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function Sheet({ open, onOpenChange, side = "left", children, title }: {
  open: boolean; onOpenChange: (o: boolean) => void; side?: "left" | "right" | "bottom"; children: ReactNode; title: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <D.Content className={cn("fixed z-50 overflow-y-auto border-border bg-panel shadow-2xl",
          side === "left" && "inset-y-0 left-0 w-72 border-r",
          side === "right" && "inset-y-0 right-0 w-[22rem] max-w-full border-l",
          side === "bottom" && "inset-x-0 bottom-0 max-h-[85vh] rounded-t-xl border-t")}>
          <D.Title className="sr-only">{title}</D.Title>
          <D.Description className="sr-only">{title}</D.Description>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
