import { redirect } from "next/navigation";
import { staffAuthConfig } from "@roco/shared/staff-auth";
import { SignIn } from "../../components/sign-in";
export const dynamic = "force-dynamic";

export default function SignInPage() {
  if (staffAuthConfig()) redirect("/admin/sign-in?returnTo=%2F");
  return <SignIn />;
}
