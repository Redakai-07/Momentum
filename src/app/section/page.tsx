"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CustomSectionView } from "@/components/views/custom-section-view";

function SectionPageContent() {
  const params = useSearchParams();
  return <CustomSectionView sectionId={params.get("sectionId") ?? ""} />;
}

export default function SectionPage() {
  return (
    <Suspense fallback={null}>
      <SectionPageContent />
    </Suspense>
  );
}
