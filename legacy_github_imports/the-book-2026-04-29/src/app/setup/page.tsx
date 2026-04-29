import { Suspense } from "react";

import { WorkspaceLab } from "@/components/setup/workspace-lab";

export default function SetupPage() {
  return (
    <Suspense fallback={null}>
      <WorkspaceLab />
    </Suspense>
  );
}
