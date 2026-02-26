import { Assistant } from "@/app/assistant";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";

interface RoomPageProps {
  params: Promise<{
    roomId: string;
  }>;
}

export default async function RoomPage({ params }: RoomPageProps) {
  const { roomId } = await params;

  return (
    <SidebarProvider>
      <main className="flex h-screen w-full overflow-hidden bg-white">
        <div className="flex-1">
          <Assistant roomId={roomId} />
        </div>
        <AppSidebar />
      </main>
    </SidebarProvider>
  );
}
