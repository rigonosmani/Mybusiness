import Link from "next/link";
import { Logo } from "@/components/brand";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <Logo />
      <p className="text-6xl font-extrabold text-gradient">404</p>
      <Link href="/" className="text-sm text-primary hover:underline">← Kometa</Link>
    </main>
  );
}
