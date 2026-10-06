import { Tag } from '../../components/ui.jsx';
import { ScoreBars, ScoreTotal, SourceLink } from '../sales-shared.jsx';

/** Right column for sales items: the angle, the facts behind it and the lead score. */
export function ApprovalSide({ approval: a, outreachAt }) {
  const facts = (a.facts ?? []).filter((f) => f?.text);
  const parts = a.scoreBreakdown ?? [];
  const company = a.account?.name;

  return (
    <>
      <div className="ap-side-block">
        <h2>Why this angle</h2>
        <p className="ap-side-text">{a.angle || 'No angle was recorded for this draft.'}</p>
      </div>

      <div className="ap-side-block ap-side-gap">
        <span className="ap-side-label">Facts from the research brief</span>
        {facts.length === 0 ? (
          <span className="ap-side-text">No facts attached to this draft.</span>
        ) : (
          facts.map((f, i) => (
            <div key={i} className="ap-fact">
              <span className="ap-fact-n">{i + 1}</span>
              <div className="ap-fact-body">
                <span>{f.text}</span>
                {f.src && <SourceLink src={f.src} />}
              </div>
            </div>
          ))
        )}
        <div className="ap-side-links">
          {a.account && (
            <a href={`#/accounts/${a.account.id}`} className="arrow-link">
              Full brief for {company} →
            </a>
          )}
          {a.threadId && (
            <a href={`#/conversations/${a.threadId}`} className="arrow-link">
              Open the conversation →
            </a>
          )}
        </div>
      </div>

      <div className="ap-side-block ap-side-gap ap-side-last">
        <div className="ap-score-head">
          <span className="ap-side-label">Lead score</span>
          <ScoreTotal value={a.score} />
        </div>
        {parts.length ? <ScoreBars parts={parts} /> : <span className="ap-side-text">Qualifier hasn’t scored this contact yet.</span>}
        {(a.decision || a.scoredAgo) && (
          <div className="ap-decision">
            {a.decision && <Tag kind="decision" value={a.decision} />}
            <span>
              {outreachAt}+ goes to outreach
              {a.scoredAgo ? ` · scored by Qualifier ${a.scoredAgo}` : ''}
            </span>
          </div>
        )}
      </div>
    </>
  );
}
