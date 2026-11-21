"use client";
import { useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { errorMessage } from "@/lib/errors";

/** Wraps an async action with loading state and localized error toasts. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>, opts: { success?: string; onSuccess?: (r: R) => void } = {}) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const run = async (...args: A): Promise<R | undefined> => {
    setPending(true);
    try {
      const r = await fn(...args);
      if (opts.success) toast.success(opts.success);
      opts.onSuccess?.(r);
      return r;
    } catch (e) {
      toast.error(errorMessage(e, t));
      return undefined;
    } finally {
      setPending(false);
    }
  };
  return { run, pending };
}
