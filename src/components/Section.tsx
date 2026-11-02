import type { ReactNode } from "react";

export function Section({
  id,
  num,
  title,
  lead,
  children,
}: {
  id: string;
  num: string;
  title: ReactNode;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section" id={id}>
      <div className="shell">
        <div className="section__head">
          <div className="section__num">{num}</div>
          <div>
            <h2 className="section__title">{title}</h2>
            {lead && <p className="section__lead">{lead}</p>}
          </div>
        </div>
        {children}
      </div>
    </section>
  );
}
