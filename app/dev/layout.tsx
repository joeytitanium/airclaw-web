import { redirect } from "next/navigation";

export default async function DevLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (process.env.NODE_ENV === "production") {
    redirect("/");
  }

  return <>{children}</>;
}
