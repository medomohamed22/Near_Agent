"use client";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ExtrudeGeometry, Shape, Vector3, type Group } from "three";
import type { RecordKind } from "@/lib/types";

export type Zone = { id: string; label: string; kinds: RecordKind[]; position: [number, number, number]; count: number; alert: boolean };

type Props = { zones: Zone[]; active: string | null; onPick: (zone: Zone | null) => void; dark: boolean };

const WHEEL_X = 1.32;
const WHEEL_R = 0.37;

/** Side silhouette of a sedan, extruded across its width with rounded edges. */
function useCarGeometry() {
  return useMemo(() => {
    const body = new Shape();
    body.moveTo(-2.15, 0.42);
    body.lineTo(-2.2, 0.62);
    body.quadraticCurveTo(-2.23, 0.99, -1.95, 1.03);
    body.lineTo(-1.45, 1.07);
    body.quadraticCurveTo(-1.05, 1.45, -0.55, 1.48);
    body.lineTo(0.2, 1.48);
    body.quadraticCurveTo(0.62, 1.45, 1.05, 1.06);
    body.lineTo(1.9, 0.96);
    body.quadraticCurveTo(2.21, 0.91, 2.23, 0.66);
    body.lineTo(2.15, 0.42);
    body.lineTo(WHEEL_X + 0.47, 0.42);
    body.absarc(WHEEL_X, 0.4, 0.47, 0, Math.PI, false);
    body.lineTo(-WHEEL_X + 0.47, 0.42);
    body.absarc(-WHEEL_X, 0.4, 0.47, 0, Math.PI, false);
    body.lineTo(-2.15, 0.42);
    // bevelOffset pulls the rounded edge inward, so the widest section keeps the drawn outline.
    const bodyGeo = new ExtrudeGeometry(body, { depth: 1.46, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelOffset: -0.1, bevelSegments: 6, curveSegments: 24 });
    bodyGeo.translate(0, 0, -0.73);

    // Side windows: a slab slightly wider than the body, so only its faces show.
    const side = new Shape();
    side.moveTo(-1.16, 1.1);
    side.quadraticCurveTo(-0.9, 1.33, -0.52, 1.35);
    side.lineTo(0.16, 1.35);
    side.quadraticCurveTo(0.5, 1.33, 0.8, 1.1);
    side.lineTo(-1.16, 1.1);
    const glassGeo = new ExtrudeGeometry(side, { depth: 1.712, bevelEnabled: false, curveSegments: 16 });
    glassGeo.translate(0, 0, -0.856);

    // Windscreen, rear window and roof glass: the cabin outline raised a hair above the paint.
    const top = new Shape();
    const lift = 0.014;
    top.moveTo(-1.38, 1.1);
    top.lineTo(-1.42, 1.09 + lift);
    top.quadraticCurveTo(-1.05, 1.45 + lift, -0.55, 1.48 + lift);
    top.lineTo(0.2, 1.48 + lift);
    top.quadraticCurveTo(0.62, 1.45 + lift, 1.02, 1.08 + lift);
    top.lineTo(0.98, 1.1);
    top.lineTo(-1.38, 1.1);
    const canopyGeo = new ExtrudeGeometry(top, { depth: 1.3, bevelEnabled: false, curveSegments: 20 });
    canopyGeo.translate(0, 0, -0.65);
    return { bodyGeo, glassGeo, canopyGeo };
  }, []);
}

function Wheel({ x, z }: { x: number; z: number }) {
  const side = Math.sign(z);
  return (
    <group position={[x, WHEEL_R, z]} rotation={[Math.PI / 2, 0, 0]}>
      <mesh castShadow><cylinderGeometry args={[WHEEL_R, WHEEL_R, 0.27, 40]} /><meshStandardMaterial color="#111318" roughness={0.85} /></mesh>
      <mesh position={[0, side * 0.01, 0]}><cylinderGeometry args={[0.25, 0.25, 0.28, 32]} /><meshStandardMaterial color="#d7dbe6" metalness={0.95} roughness={0.22} /></mesh>
      <mesh position={[0, side * 0.02, 0]}><cylinderGeometry args={[0.19, 0.19, 0.285, 32]} /><meshStandardMaterial color="#8d93a6" metalness={0.8} roughness={0.35} /></mesh>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} position={[0, side * 0.03, 0]} rotation={[0, (i * Math.PI * 2) / 5, 0]}>
          <boxGeometry args={[0.46, 0.29, 0.055]} /><meshStandardMaterial color="#e6e9f2" metalness={0.95} roughness={0.2} />
        </mesh>
      ))}
      <mesh position={[0, side * 0.04, 0]}><cylinderGeometry args={[0.07, 0.07, 0.3, 20]} /><meshStandardMaterial color="#c9cedb" metalness={0.9} roughness={0.25} /></mesh>
    </group>
  );
}

function Car({ dark }: { dark: boolean }) {
  const { bodyGeo, glassGeo, canopyGeo } = useCarGeometry();
  const paint = <meshPhysicalMaterial color={dark ? "#7a6cff" : "#6a5cff"} metalness={0.3} roughness={0.3} clearcoat={1} clearcoatRoughness={0.06} envMapIntensity={1.5} />;
  const glassMat = <meshPhysicalMaterial color="#141a33" metalness={0.85} roughness={0.05} clearcoat={1} envMapIntensity={2} />;
  const trim = <meshStandardMaterial color="#12141c" roughness={0.6} metalness={0.4} />;
  return (
    <group>
      <mesh geometry={bodyGeo} castShadow>{paint}</mesh>
      <mesh geometry={glassGeo}>{glassMat}</mesh>
      <mesh geometry={canopyGeo}>{glassMat}</mesh>
      {/* Painted roof panel over the glass. */}
      <mesh position={[-0.175, 1.5, 0]}><boxGeometry args={[0.62, 0.025, 1.22]} />{paint}</mesh>
      {/* Pillar between the doors, mirrors, sills. */}
      <mesh position={[-0.2, 1.22, 0]}><boxGeometry args={[0.07, 0.3, 1.716]} />{paint}</mesh>
      <mesh position={[0.86, 1.12, 0.93]}><boxGeometry args={[0.16, 0.09, 0.16]} />{paint}</mesh>
      <mesh position={[0.86, 1.12, -0.93]}><boxGeometry args={[0.16, 0.09, 0.16]} />{paint}</mesh>
      <mesh position={[0, 0.43, 0]}><boxGeometry args={[1.7, 0.08, 1.74]} />{trim}</mesh>
      {/* Front: grille, headlights. */}
      <mesh position={[2.215, 0.58, 0]}><boxGeometry args={[0.05, 0.15, 1.05]} />{trim}</mesh>
      {[0.5, -0.5].map((z) => (
        <mesh key={z} position={[2.2, 0.8, z]}><boxGeometry args={[0.1, 0.1, 0.4]} /><meshStandardMaterial color="#fffdf2" emissive="#fff3c4" emissiveIntensity={dark ? 2.6 : 1.1} /></mesh>
      ))}
      {/* Rear: one light bar across the boot. */}
      <mesh position={[-2.2, 0.86, 0]}><boxGeometry args={[0.08, 0.07, 1.36]} /><meshStandardMaterial color="#ff4d5e" emissive="#ff2740" emissiveIntensity={dark ? 2.4 : 1.2} /></mesh>
      <mesh position={[-2.21, 0.56, 0]}><boxGeometry args={[0.05, 0.12, 1.2]} />{trim}</mesh>
      <Wheel x={WHEEL_X} z={0.73} /><Wheel x={WHEEL_X} z={-0.73} />
      <Wheel x={-WHEEL_X} z={0.73} /><Wheel x={-WHEEL_X} z={-0.73} />
    </group>
  );
}

/** A turntable under the car, with a soft ring. */
function Platform({ dark }: { dark: boolean }) {
  return (
    <group position={[0, -0.04, 0]}>
      <mesh receiveShadow><cylinderGeometry args={[3.1, 3.2, 0.08, 72]} /><meshStandardMaterial color={dark ? "#1b2040" : "#e9ebf8"} metalness={0.3} roughness={0.45} /></mesh>
      <mesh position={[0, 0.045, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[2.86, 2.93, 96]} /><meshBasicMaterial color={dark ? "#8b7dff" : "#5b4bff"} transparent opacity={dark ? 0.9 : 0.55} /></mesh>
    </group>
  );
}

/** Keeps each marker button over its point on the car as the car turns. */
function Tracker({ zones, markers, rig }: { zones: Zone[]; markers: RefObject<(HTMLButtonElement | null)[]>; rig: RefObject<Group | null> }) {
  const point = useRef(new Vector3());
  useFrame(({ camera, size }) => {
    zones.forEach((z, i) => {
      const el = markers.current[i];
      if (!el || !rig.current) return;
      point.current.set(...z.position).applyMatrix4(rig.current.matrixWorld).project(camera);
      const x = (point.current.x * 0.5 + 0.5) * size.width;
      const y = (-point.current.y * 0.5 + 0.5) * size.height;
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    });
  });
  return null;
}

/** A turnable car whose markers filter the timeline. The same filters exist as plain buttons above the timeline. */
export default function Car3D({ zones, active, onPick, dark }: Props) {
  // Loaded in the browser only, so the media query is safe to read here.
  const [still] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const markers = useRef<(HTMLButtonElement | null)[]>([]);
  const rig = useRef<Group>(null);
  const box = useRef<HTMLDivElement>(null);
  // Draw only while the car is on screen; an off-screen turntable would keep
  // the graphics chip busy for nothing.
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={box} className="relative h-full w-full" dir="ltr">
      <Canvas frameloop={visible ? "always" : "never"} shadows camera={{ position: [6.0, 2.7, 6.6], fov: 30 }} dpr={[1, 2]} onPointerMissed={() => onPick(null)}>
        <ambientLight intensity={dark ? 0.45 : 0.9} />
        <directionalLight position={[4, 7, 5]} intensity={dark ? 1.3 : 1.9} castShadow shadow-mapSize={[1024, 1024]} />
        <directionalLight position={[-6, 3, -4]} intensity={0.6} color="#8b7dff" />
        {/* Studio light panels, so the paint has something to reflect. No files are downloaded. */}
        <Environment resolution={256}>
          <Lightformer form="rect" intensity={dark ? 2.2 : 3} position={[0, 5, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[10, 4, 1]} />
          <Lightformer form="rect" intensity={dark ? 1.4 : 2} position={[-6, 2, 2]} rotation={[0, Math.PI / 2, 0]} scale={[6, 2, 1]} color="#b9c2ff" />
          <Lightformer form="rect" intensity={dark ? 1.2 : 2} position={[6, 2, -2]} rotation={[0, -Math.PI / 2, 0]} scale={[6, 2, 1]} color="#ffd9ec" />
          <Lightformer form="ring" intensity={dark ? 1.5 : 1} position={[0, 2, 7]} scale={3} color="#7af0ff" />
        </Environment>
        <group ref={rig}>
          <Car dark={dark} />
          <Platform dark={dark} />
        </group>
        <Tracker zones={zones} markers={markers} rig={rig} />
        <ContactShadows position={[0, 0.005, 0]} opacity={dark ? 0.7 : 0.45} scale={8} blur={2.2} far={2.5} />
        <OrbitControls target={[0, 0.6, 0]} enablePan={false} enableZoom={false} autoRotate={!still && !active} autoRotateSpeed={1.1} minPolarAngle={0.95} maxPolarAngle={1.42} />
      </Canvas>
      {zones.map((z, i) => {
        const on = active === z.id;
        return (
          <button key={z.id} ref={(el) => { markers.current[i] = el; }} type="button" onClick={() => onPick(on ? null : z)} aria-pressed={on} className={`marker ${z.alert && !on ? "alert" : ""}`}>
            {z.label}<b>{z.count}</b>
          </button>
        );
      })}
    </div>
  );
}
