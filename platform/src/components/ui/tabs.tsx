"use client";
import * as T from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

export const Tabs = T.Root;
export const TabsContent = T.Content;
export function TabsList({ className, ...p }: ComponentProps<typeof T.List>) {
  return <T.List className={cn("inline-flex flex-wrap gap-1 rounded-lg bg-panel-2 p-1", className)} {...p} />;
}
export function TabsTrigger({ className, ...p }: ComponentProps<typeof T.Trigger>) {
  return <T.Trigger className={cn("rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition data-[state=active]:bg-panel-3 data-[state=active]:text-foreground", className)} {...p} />;
}
