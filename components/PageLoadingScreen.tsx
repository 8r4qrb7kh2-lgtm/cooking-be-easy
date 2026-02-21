import { Loader2 } from "lucide-react";
import GooseChefLogo from "./GooseChefLogo";

interface PageLoadingScreenProps {
  label?: string;
}

export default function PageLoadingScreen({
  label = "Loading recipes",
}: PageLoadingScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20" role="status" aria-live="polite">
      <GooseChefLogo size={96} />
      <Loader2 size={28} className="mt-4 text-brand-500 animate-spin" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
