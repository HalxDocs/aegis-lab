const packages = [
  {
    name: "internal/domain",
    role: "the vocabulary",
    files: [
      ["time.go", "virtual ticks, in whole nanoseconds"],
      ["node.go", "running → crashed, and nothing else"],
      ["observation.go", "one observer's belief about one target"],
      ["failure.go", "typed evidence, refuses to be written early"],
      ["event.go", "the closed vocabulary of the log"],
    ],
  },
  {
    name: "internal/sim",
    role: "the world",
    files: [
      ["scheduler.go", "orders work by (time, class, seq)"],
      ["network.go", "declared links, latency, send-time loss"],
      ["node.go", "heartbeat rounds and the crash"],
      ["engine.go", "owns the clock, the network and the truth"],
      ["rand.go", "splitmix64, so replay survives upgrades"],
    ],
  },
  {
    name: "internal/detector",
    role: "the worried friend",
    files: [
      ["detector.go", "messages in, beliefs out"],
      ["deadline.go", "the stopwatch, and the epoch guard"],
    ],
  },
  {
    name: "internal/observability",
    role: "the diary",
    files: [
      ["recorder.go", "assigns sequence numbers, prints one JSON object per line"],
    ],
  },
  {
    name: "internal/scenario",
    role: "the recipe",
    files: [
      ["spec.go", "the world as data, validated first"],
      ["run.go", "the only place that wires everything together"],
      ["result.go", "truth and belief, as two separate fields"],
    ],
  },
  {
    name: "cmd/aegis",
    role: "the remote control",
    files: [
      ["main.go", "flags, scenario lookup, output choice"],
      ["table.go", "the human-readable view, derived from the log"],
    ],
  },
];

export function CodeMap() {
  return (
    <div>
      <div className="map__grid">
        {packages.map((pkg) => (
          <article className="map__pkg" key={pkg.name}>
            <div className="map__name">{pkg.name}</div>
            <div className="map__role">{pkg.role}</div>
            <div className="map__files">
              {pkg.files.map(([file, description]) => (
                <div className="map__file" key={`${pkg.name}-${file}-${description}`}>
                  <b>{file}</b> — {description}
                </div>
              ))}
            </div>
            <a
              className="map__link"
              href={`https://github.com/HalxDocs/aegis/tree/main/${pkg.name}`}
              target="_blank"
              rel="noreferrer"
            >
              open {pkg.name.split("/")[1]} ↗
            </a>
          </article>
        ))}
      </div>
      <p className="panel-note">
        The dependency rule is enforced by a test, not by review: the detector may import the domain and nothing
        else, and only the scenario package may import both the simulator and the detector.
      </p>
    </div>
  );
}
