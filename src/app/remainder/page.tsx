import type { Metadata } from "next";
import { RemainderView } from "@/components/views/remainder-view";

export const metadata: Metadata = { title: "Remainder" };

export default function RemainderPage() {
  return <RemainderView />;
}
