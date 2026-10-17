import { BoardHero } from "@/components/picks/board-hero";
import { BoardView } from "@/components/picks/board-view";
import { CouponAside, CouponMobileBar } from "@/components/picks/coupon-dock";

export default function HomePage() {
  return (
    <div className="flex items-start gap-6">
      <div className="min-w-0 flex-1 space-y-6">
        <BoardHero />
        <BoardView />
      </div>
      <CouponAside />
      <CouponMobileBar />
    </div>
  );
}
