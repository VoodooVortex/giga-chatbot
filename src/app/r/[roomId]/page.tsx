import { Assistant } from "@/app/assistant";

interface RoomPageProps {
  params: Promise<{
    roomId: string;
  }>;
}

export default async function RoomPage({ params }: RoomPageProps) {
  const { roomId } = await params;

  return (
    <div className="flex-1 min-w-0">
      {/* key forces a full remount when navigating between different rooms */}
      <Assistant key={roomId} roomId={roomId} />
    </div>
  );
}
