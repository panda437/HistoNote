import { WorkspaceGate } from "@/components/WorkspaceGate";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceGate>{children}</WorkspaceGate>;
}
