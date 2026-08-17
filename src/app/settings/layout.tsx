import { PinGate } from "@/components/settings/PinGate";

// Every /settings/* page sits behind the manager PIN (see PinGate for
// the honest scope of that protection). Log pages are deliberately open.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <PinGate>{children}</PinGate>;
}
