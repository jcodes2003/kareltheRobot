"use client";

import { useState, useEffect, KeyboardEvent } from "react";

type Direction = "up" | "right" | "down" | "left";
type Position = { x: number; y: number };
type Command = { type: "move" | "turnLeft" | "turnRight" | "pickBeeper" | "putBeeper" };

const INITIAL_SCRIPT = `from karel.stanfordkarel import *

def main():
    move()
    turn_left()
    move()
    turn_right()
    move()`;

const DIRECTION_ARROW: Record<Direction, string> = {
  up: "↑",
  right: "→",
  down: "↓",
  left: "←",
};

const GRID_SIZE = 6;
const WALLS = new Set<string>([
  "3,1",
  "3,2",
  "3,3",
  "3,4",
  "1,4",
  "2,4",
  "0,4",
]);

function parseCommands(raw: string): Command[] {
  const lines = raw.split(/\r?\n/);
  const importLine = lines.find((line) => line.trim().startsWith("from karel.stanfordkarel import *"));
  const mainIndex = lines.findIndex((line) => line.trim().startsWith("def main():"));

  if (!importLine || mainIndex === -1) {
    return [];
  }

  // Find first non-empty line after def main(): this determines required indentation
  let bodyStart = mainIndex + 1;
  while (bodyStart < lines.length && lines[bodyStart].trim() === "") bodyStart++;

  if (bodyStart >= lines.length) {
    return [];
  }

  const indentMatch = lines[bodyStart].match(/^(\s+)/);
  if (!indentMatch) {
    // No indentation found; treat as missing body
    return [];
  }

  const indentPrefix = indentMatch[1];

  // Collect consecutive lines that are indented at least as much as indentPrefix
  const bodyLines: string[] = [];
  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue; // ignore blank lines
    if (line.startsWith(indentPrefix)) {
      bodyLines.push(line.slice(indentPrefix.length));
    } else {
      break; // stop at first non-indented line
    }
  }

  const cleaned = bodyLines
    .map((line) => line.split("#")[0].trim())
    .filter(Boolean)
    .flatMap((line) => line.split(";").map((part) => part.trim()).filter(Boolean));

  const commands: Command[] = [];

  for (const entry of cleaned) {
    const repeatMatch = entry.match(/^repeat\s+(\d+)\s*\[(.+)\]$/i);

    if (repeatMatch) {
      const repeatCount = Number(repeatMatch[1]);
      const innerCommands = repeatMatch[2]
        .split(/\s+/)
        .map((item) => item.trim())
        .filter(Boolean);

      for (let index = 0; index < repeatCount; index += 1) {
        for (const item of innerCommands) {
          const parsed = parseSingleCommand(item);
          if (parsed) {
            commands.push(parsed);
          }
        }
      }
      continue;
    }

    const parsed = parseSingleCommand(entry);
    if (parsed) {
      commands.push(parsed);
    }
  }

  return commands;
}

function parseSingleCommand(entry: string): Command | null {
  switch (entry.toLowerCase()) {
    case "move":
    case "move()":
      return { type: "move" };
    case "turnleft":
    case "turn_left":
    case "turnleft()":
    case "turn_left()":
      return { type: "turnLeft" };
    case "turnright":
    case "turn_right":
    case "turnright()":
    case "turn_right()":
      return { type: "turnRight" };
    case "pickbeeper":
    case "pick_beeper":
    case "pickbeeper()":
    case "pick_beeper()":
      return { type: "pickBeeper" };
    case "putbeeper":
    case "put_beeper":
    case "putbeeper()":
    case "put_beeper()":
      return { type: "putBeeper" };
    default:
      return null;
  }
}

function getNextPosition(position: Position, direction: Direction): Position {
  switch (direction) {
    case "up":
      return { x: position.x, y: position.y - 1 };
    case "right":
      return { x: position.x + 1, y: position.y };
    case "down":
      return { x: position.x, y: position.y + 1 };
    case "left":
      return { x: position.x - 1, y: position.y };
  }
}

function turnLeft(direction: Direction): Direction {
  switch (direction) {
    case "up":
      return "left";
    case "left":
      return "down";
    case "down":
      return "right";
    case "right":
      return "up";
  }
}

function turnRight(direction: Direction): Direction {
  switch (direction) {
    case "up":
      return "right";
    case "right":
      return "down";
    case "down":
      return "left";
    case "left":
      return "up";
  }
}

function pickRandomCell(exclude = new Set<string>()): string {
  const maxAttempts = 200;
  for (let i = 0; i < maxAttempts; i++) {
    const x = Math.floor(Math.random() * GRID_SIZE);
    const y = Math.floor(Math.random() * GRID_SIZE);
    const key = `${x},${y}`;
    if (exclude.has(key)) continue;
    if (WALLS.has(key)) continue;
    return key;
  }
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const key = `${x},${y}`;
      if (!exclude.has(key) && !WALLS.has(key)) return key;
    }
  }
  return "0,0";
}

export default function Home() {
  const [script, setScript] = useState(INITIAL_SCRIPT);
  const [position, setPosition] = useState<Position>({ x: 2, y: 2 });
  const [direction, setDirection] = useState<Direction>("up");
  const [beepers, setBeepers] = useState<Set<string>>(new Set());
  const [hole, setHole] = useState<string | null>(null);
  const [carriedBeepers, setCarriedBeepers] = useState(0);
  const [message, setMessage] = useState("Ready to run your robot script.");
  const [error, setError] = useState<string | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  const runScript = () => {
    const commands = parseCommands(script);

    if (commands.length === 0) {
      setMessage("Missing required Python wrapper or no valid commands found.");
      setError("Script must include 'from karel.stanfordkarel import *' and 'def main():'.");
      return;
    }

    let nextPosition = { ...position };
    let nextDirection: Direction = direction;
    let nextBeepers = new Set<string>(beepers);
    let nextCarried = carriedBeepers;

    for (const command of commands) {
      if (command.type === "move") {
        const candidate = getNextPosition(nextPosition, nextDirection);
        const candidateKey = `${candidate.x},${candidate.y}`;

        if (candidate.x < 0 || candidate.x >= GRID_SIZE || candidate.y < 0 || candidate.y >= GRID_SIZE) {
          setError("The robot bumped into the edge of the world.");
          setMessage("Execution stopped at the edge.");
          setPosition(nextPosition);
          setDirection(nextDirection);
          setBeepers(nextBeepers);
          setCarriedBeepers(nextCarried);
          return;
        }

        if (WALLS.has(candidateKey)) {
          setError("The robot hit a wall and cannot move through it.");
          setMessage("Execution stopped by a wall.");
          setPosition(nextPosition);
          setDirection(nextDirection);
          setBeepers(nextBeepers);
          setCarriedBeepers(nextCarried);
          return;
        }

        nextPosition = candidate;
      } else if (command.type === "turnLeft") {
        nextDirection = turnLeft(nextDirection);
      } else if (command.type === "turnRight") {
        nextDirection = turnRight(nextDirection);
      } else if (command.type === "pickBeeper") {
        const key = `${nextPosition.x},${nextPosition.y}`;
        if (nextBeepers.has(key)) {
          nextBeepers.delete(key);
          nextCarried += 1;
        }
      } else if (command.type === "putBeeper") {
        if (nextCarried > 0) {
          const key = `${nextPosition.x},${nextPosition.y}`;
          nextBeepers.add(key);
          nextCarried -= 1;

          if (hole && key === hole) {
            // Robot put a beeper into the hole — reset world with new random placements
            const base = new Set(["2,2", "3,1", "1,4"]);
            const extra = pickRandomCell(base);
            base.add(extra);
            const newHole = pickRandomCell(base);

            setPosition({ x: 2, y: 2 });
            setDirection("up");
            setBeepers(base);
            setHole(newHole);
            setCarriedBeepers(0);
            setError(null);
            setMessage("You dropped the beeper into the hole — world reset.");
            setShowSuccessModal(true);
            return;
          }
        }
      }
    }

    setPosition(nextPosition);
    setDirection(nextDirection);
    setBeepers(nextBeepers);
    setCarriedBeepers(nextCarried);
    setError(null);
    setMessage(`Finished after ${commands.length} command${commands.length === 1 ? "" : "s"}.`);
  };

  const resetWorld = () => {
    const base = new Set(["2,2", "3,1", "1,4"]);
    const extra = pickRandomCell(base);
    base.add(extra);
    const holeKey = pickRandomCell(base);

    setPosition({ x: 2, y: 2 });
    setDirection("up");
    setBeepers(base);
    setHole(holeKey);
    setCarriedBeepers(0);
    setMessage("World reset. Type a new script.");
    setError(null);
  };

  useEffect(() => {
    resetWorld();
  }, []);

  function handleScriptKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const el = e.currentTarget as HTMLTextAreaElement;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const val = el.value;
    const lineStart = val.lastIndexOf("\n", start - 1);
    const lineStartIndex = lineStart === -1 ? 0 : lineStart + 1;
    const line = val.slice(lineStartIndex, start);
    const indentMatch = line.match(/^(\s+)/);
    const indent = indentMatch ? indentMatch[1] : "    ";
    const insert = "\n" + indent;
    const newValue = val.slice(0, start) + insert + val.slice(end);
    setScript(newValue);
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + insert.length;
    });
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100 sm:px-6 lg:px-8">
      {showSuccessModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-3xl bg-zinc-950 p-6 shadow-2xl shadow-black/70">
            <h2 className="text-2xl font-semibold text-emerald-300">Success!</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-200">
              The robot dropped the beeper into the hole and the world was reset with new placements.
            </p>
            <button
              type="button"
              onClick={() => setShowSuccessModal(false)}
              className="mt-6 inline-flex rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
      <div className="mx-auto flex max-w-6xl flex-col gap-6 rounded-3xl border border-zinc-800 bg-zinc-900/80 p-6 shadow-2xl shadow-black/30">
        <header className="space-y-2">
          <p className="text-sm uppercase tracking-[0.35em] text-emerald-400">Karel-inspired robot</p>
          <h1 className="text-3xl font-semibold sm:text-4xl">Teach a tiny robot to move with a script</h1>
          <p className="max-w-2xl text-sm text-zinc-400 sm:text-base">
            Type commands, run the script, and watch the robot navigate a tiny world. You can use
            move, turnLeft, turnRight, pickBeeper, putBeeper, or small repeat blocks.
          </p>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-medium">Robot world</h2>
              <div className="text-sm text-zinc-400">Size: {GRID_SIZE} × {GRID_SIZE}</div>
            </div>

            <div className="grid grid-cols-6 gap-2">
              {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, index) => {
                const x = index % GRID_SIZE;
                const y = Math.floor(index / GRID_SIZE);
                const key = `${x},${y}`;
                const isRobot = position.x === x && position.y === y;
                const hasBeeper = beepers.has(key);
                const isWall = WALLS.has(key);
                const isHole = hole === key;

                return (
                  <div
                    key={key}
                    className={`flex aspect-square items-center justify-center rounded-xl border text-2xl ${
                      isRobot
                        ? "border-emerald-400 bg-emerald-500/20"
                        : isWall
                        ? "border-zinc-600 bg-zinc-700 text-zinc-200"
                        : isHole
                        ? "border-rose-600 bg-rose-900/40 text-rose-300"
                        : "border-zinc-800 bg-zinc-900"
                    }`}
                  >
                    {isRobot ? DIRECTION_ARROW[direction] : isWall ? "🧱" : isHole ? "🕳️" : hasBeeper ? "🔵" : "·"}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap gap-3 text-sm text-zinc-400">
              <div className="rounded-full border border-zinc-800 px-3 py-1">Facing: {direction}</div>
              <div className="rounded-full border border-zinc-800 px-3 py-1">Beeper bag: {carriedBeepers}</div>
              <div className="rounded-full border border-zinc-800 px-3 py-1">Position: ({position.x}, {position.y})</div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
              <label className="mb-2 block text-sm font-medium text-zinc-300" htmlFor="script">
                Robot script
              </label>
              <textarea
                id="script"
                value={script}
                onChange={(event) => setScript(event.target.value)}
                onKeyDown={handleScriptKeyDown}
                className="h-[28rem] min-h-[28rem] w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-3 font-mono text-sm text-zinc-100 outline-none ring-0"
                spellCheck={false}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={runScript}
                  className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400"
                >
                  Run script
                </button>
                <button
                  type="button"
                  onClick={resetWorld}
                  className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:bg-zinc-800"
                >
                  Reset world
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
              <h3 className="text-sm font-medium uppercase tracking-[0.2em] text-zinc-400">Status</h3>
              <p className="mt-2 text-sm text-zinc-200">{message}</p>
              {error ? <p className="mt-2 text-sm text-rose-400">{error}</p> : null}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
