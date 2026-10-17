import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="numeric text-6xl font-extrabold text-primary">404</p>
      <h1 className="text-xl font-extrabold">Страница не найдена</h1>
      <Button asChild>
        <Link href="/">К линиям</Link>
      </Button>
    </div>
  );
}
