import { Suspense } from "react";
import { SportsBrowser } from "@/components/sports/sports-browser";

export const metadata = { title: "Sports" };
export default function SportsPage() {
  return <Suspense><SportsBrowser /></Suspense>;
}
