import { Suspense } from "react";
import { SportsBrowser } from "@/components/sports/sports-browser";

export const metadata = { title: "Live" };
export default function LivePage() {
  return <Suspense><SportsBrowser live /></Suspense>;
}
