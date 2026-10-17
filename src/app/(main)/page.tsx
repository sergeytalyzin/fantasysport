import { BoardHero } from "@/components/picks/board-hero";
import { CouponAside, CouponMobileBar } from "@/components/picks/coupon-dock";
import { HomeView } from "@/components/picks/home-view";

export default function HomePage() {
  return (
    <div className="flex items-start gap-6">
      <div className="min-w-0 flex-1 space-y-6">
        <BoardHero />
        <HomeView />
      </div>
      <CouponAside />
      <CouponMobileBar />
    </div>
  );
}
