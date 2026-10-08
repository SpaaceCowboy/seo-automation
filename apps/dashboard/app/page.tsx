import { redirect } from "next/navigation";
import { authenticatedSession } from "../lib/server";
import { ControlCenter } from "../components/control-center";
export default async function HomePage() {
  const session = await authenticatedSession();
  if (!session) redirect("/sign-in");
  return (
    <ControlCenter
      identity={session.identity}
      csrf={session.csrf}
      staffLogin={session.token.startsWith("StaffSession ")}
    />
  );
}
