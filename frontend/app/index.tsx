import { Redirect } from "expo-router";

import { homeFor, useAuth } from "@/src/auth/AuthContext";

// The root layout waits for session restore, so `me` is final here.
export default function Index() {
  const { me } = useAuth();
  return <Redirect href={homeFor(me)} />;
}
