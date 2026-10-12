import { Redirect, Stack } from "expo-router";

import { homeFor, useAuth } from "@/src/auth/AuthContext";

export default function OwnerLayout() {
  const { me } = useAuth();
  if (!me) return <Redirect href="/login" />;
  if (me.user.role !== "owner" || me.user.must_change_password) return <Redirect href={homeFor(me)} />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
