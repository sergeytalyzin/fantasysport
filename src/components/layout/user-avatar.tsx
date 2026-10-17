import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const PALETTE = ["#7c8cff", "#3df5a7", "#ffc83d", "#ff8a5c", "#c084fc", "#38bdf8"];

function colorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function UserAvatar({
  nickname,
  url,
  className,
}: {
  nickname: string;
  url: string | null | undefined;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-9", className)}>
      {url ? <AvatarImage src={url} alt={nickname} /> : null}
      <AvatarFallback
        className="font-display text-xs font-bold text-primary-foreground"
        style={{ background: colorFor(nickname) }}
      >
        {nickname.slice(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}
