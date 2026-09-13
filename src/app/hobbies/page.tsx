import type { Metadata } from "next";
import { HobbyNotesView } from "@/components/hobby/hobby-notes-view";

export const metadata: Metadata = { title: "Hobby & Notes" };

export default function HobbiesPage() {
  return <HobbyNotesView />;
}
