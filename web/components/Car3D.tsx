"use client";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, OrbitControls, RoundedBox } from "@react-three/drei";
import { useRef, useState, type RefObject } from "react";
import { Vector3 } from "three";
import type { RecordKind } from "@/lib/types";

export type Zone = { id: string; label: string; kinds: RecordKind[]; position: [number, number, number]; count: number; alert: boolean };

type Props = { zones: Zone[]; active: string | null; onPick: (zone: Zone | null) => void };

function Wheel({ position }: { position: [number, number, number] }) {
  return (
    <group position={position} rotation={[Math.PI / 2, 0, 0]}>
      <mesh><cylinderGeometry args={[0.36, 0.36, 0.26, 28]} /><meshStandardMaterial color="#0b0f19" roughness={0.9} /></mesh>
      <mesh><cylinderGeometry args={[0.2, 0.2, 0.28, 20]} /><meshStandardMaterial color="#cbd5e1" metalness={0.8} roughness={0.3} /></mesh>
    </group>
  );
}

function Car() {
  return (
    <group position={[0, 0.36, 0]}>
      <RoundedBox args={[3.6, 0.62, 1.6]} radius={0.2} smoothness={5} position={[0, 0.3, 0]}>
        <meshStandardMaterial color="#14b8a6" metalness={0.55} roughness={0.32} />
      </RoundedBox>
      <RoundedBox args={[1.95, 0.6, 1.4]} radius={0.24} smoothness={5} position={[-0.15, 0.84, 0]}>
        <meshStandardMaterial color="#0f172a" metalness={0.7} roughness={0.15} />
      </RoundedBox>
      <mesh position={[1.81, 0.34, 0.5]}><boxGeometry args={[0.04, 0.14, 0.34]} /><meshStandardMaterial color="#fef9c3" emissive="#fde68a" emissiveIntensity={1.4} /></mesh>
      <mesh position={[1.81, 0.34, -0.5]}><boxGeometry args={[0.04, 0.14, 0.34]} /><meshStandardMaterial color="#fef9c3" emissive="#fde68a" emissiveIntensity={1.4} /></mesh>
      <mesh position={[-1.81, 0.36, 0.5]}><boxGeometry args={[0.04, 0.12, 0.36]} /><meshStandardMaterial color="#fecaca" emissive="#ef4444" emissiveIntensity={1.2} /></mesh>
      <mesh position={[-1.81, 0.36, -0.5]}><boxGeometry args={[0.04, 0.12, 0.36]} /><meshStandardMaterial color="#fecaca" emissive="#ef4444" emissiveIntensity={1.2} /></mesh>
      <Wheel position={[1.15, 0, 0.8]} /><Wheel position={[1.15, 0, -0.8]} />
      <Wheel position={[-1.15, 0, 0.8]} /><Wheel position={[-1.15, 0, -0.8]} />
    </group>
  );
}

/** Keeps each marker button over its point on the car as the camera turns. */
function Tracker({ zones, markers }: { zones: Zone[]; markers: RefObject<(HTMLButtonElement | null)[]> }) {
  const point = useRef(new Vector3());
  useFrame(({ camera, size }) => {
    zones.forEach((z, i) => {
      const el = markers.current[i];
      if (!el) return;
      point.current.set(...z.position).project(camera);
      const x = (point.current.x * 0.5 + 0.5) * size.width;
      const y = (-point.current.y * 0.5 + 0.5) * size.height;
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    });
  });
  return null;
}

/** A turnable car whose markers filter the timeline. The same filters exist as plain buttons above the timeline. */
export default function Car3D({ zones, active, onPick }: Props) {
  // Loaded in the browser only, so the media query is safe to read here.
  const [still] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const markers = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className="relative h-full w-full" dir="ltr">
      <Canvas camera={{ position: [4.4, 2.4, 4.8], fov: 32 }} dpr={[1, 2]} onPointerMissed={() => onPick(null)}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[5, 6, 4]} intensity={1.6} />
        <directionalLight position={[-5, 3, -4]} intensity={0.5} color="#818cf8" />
        <Car />
        <Tracker zones={zones} markers={markers} />
        <ContactShadows position={[0, 0, 0]} opacity={0.55} scale={9} blur={2.4} far={3} />
        <OrbitControls target={[0, 0.75, 0]} enablePan={false} enableZoom={false} autoRotate={!still && !active} autoRotateSpeed={0.9} minPolarAngle={0.9} maxPolarAngle={1.45} />
      </Canvas>
      {zones.map((z, i) => {
        const on = active === z.id;
        return (
          <button
            key={z.id}
            ref={(el) => { markers.current[i] = el; }}
            type="button"
            onClick={() => onPick(on ? null : z)}
            aria-pressed={on}
            className={`absolute left-0 top-0 flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold shadow-lg backdrop-blur will-change-transform ${
              on ? "border-brand bg-brand text-[#04211d]" : z.alert ? "border-warn/60 bg-[#1a1407]/90 text-warn" : "border-white/25 bg-[#0b1220]/85 text-white"
            }`}
          >
            {z.label}
            <span className={`grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] ${on ? "bg-[#04211d]/20" : "bg-white/15"}`}>{z.count}</span>
          </button>
        );
      })}
    </div>
  );
}
