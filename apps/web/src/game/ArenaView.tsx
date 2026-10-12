import { useEffect, useRef, useState } from "react";
import { Arena } from "./Arena.js";
import { loadCameraChoice, saveCameraChoice, type CameraChoice } from "./camera.js";
import type { View } from "./view.js";
import { AssetImg, Grain, Loading } from "../ui/kit.js";

/** React wrapper: owns one Arena for its lifetime and feeds it views. */
export function ArenaView(props: { view: View | null; animate?: boolean; className?: string; compact?: boolean; waiting?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const arena = useRef<Arena | null>(null);
  const latest = useRef<View | null>(props.view);
  // A compact arena always shows the whole house; otherwise your pick for this session, or the default.
  const choice = useRef<CameraChoice | null>(props.compact ? "house" : loadCameraChoice());
  const [cam, setCam] = useState<{ mode: CameraChoice; toggle: boolean } | null>(null);
  latest.current = props.view;

  useEffect(() => {
    let cancelled = false;
    let made: Arena | null = null;
    void Arena.create(host.current!).then((a) => {
      if (cancelled) {
        a.destroy();
        return;
      }
      made = a;
      arena.current = a;
      a.onCamera = (c) => setCam(c);
      a.setChoice(choice.current);
      if (latest.current) a.setView(latest.current, false);
    });
    return () => {
      cancelled = true;
      made?.destroy();
      arena.current = null;
    };
  }, []);

  useEffect(() => {
    if (!arena.current) return;
    if (props.view) arena.current.setView(props.view, props.animate ?? true);
    else arena.current.clear();
  }, [props.view, props.animate]);

  /** Flip to the other view at once; the arena reports back what is on screen, which sets the label. */
  const toggle = () => {
    if (!cam) return;
    const next: CameraChoice = cam.mode === "follow" ? "house" : "follow";
    choice.current = next;
    saveCameraChoice(next);
    arena.current?.setChoice(next);
  };

  return (
    <div className={`arena ${props.compact ? "compact" : ""} ${props.className ?? ""}`}>
      <AssetImg name="art_arena_bg" className="arena-bg" />
      <div ref={host} className="arena-host" />
      <Grain strength={0.03} />
      {props.compact || !props.view || !cam?.toggle ? null : (
        <button className="camera btn" onClick={toggle}>
          {cam.mode === "follow" ? "Show the whole house" : "Follow me"}
        </button>
      )}
      {!props.view && props.waiting !== false ? (
        <div className="arena-wait">
          <Loading label="loading the map" />
        </div>
      ) : null}
    </div>
  );
}
