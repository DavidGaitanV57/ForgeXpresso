"use client";

import { useEffect } from "react";
import { MARKUP } from "./markup";

export default function Page() {
  useEffect(() => {
    void import("./forge-client").then((m) => m.mount());
  }, []);
  return <div id="forge-root" style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: MARKUP }} />;
}
