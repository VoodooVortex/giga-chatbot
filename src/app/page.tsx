import { Assistant } from "./assistant";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";

export default function Home() {
  return (
    <SidebarProvider>
      <main className="flex h-screen w-full overflow-hidden bg-white">
        <div className="flex-1 min-w-0">
          <Assistant />
        </div>

        <AppSidebar />
      </main>
    </SidebarProvider>
  );
}
