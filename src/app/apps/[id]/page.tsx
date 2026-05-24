import { notFound } from "next/navigation";
import fs from "fs/promises";
import path from "path";

export default async function AppPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!/^[a-zA-Z0-9_-]+$/.test(id)) notFound();

  const filePath = path.join(process.cwd(), "public", "apps", id, "index.html");
  let html: string;
  try {
    html = await fs.readFile(filePath, "utf-8");
  } catch {
    notFound();
  }

  return (
    <iframe
      srcDoc={html}
      title="Deployed App"
      className="fixed inset-0 w-full h-full border-0 bg-white"
      sandbox="allow-scripts allow-same-origin allow-modals allow-forms"
    />
  );
}
