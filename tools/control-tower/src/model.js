/**
 * Shared data model. Every module reads and writes these shapes and nothing
 * else; `test/fixtures/board.json` is a complete example instance.
 *
 * Status vocabulary (see docs/plan.md §5-6 in the control-tower design docs):
 *   busy    — the agent is working on a turn
 *   wait    — the agent finished its turn and is idle at the prompt
 *   unknown — no reliable signal (e.g. codex rollout not resolved)
 *
 * `my_turn` is derived in status.js:
 *   (status === 'wait' && spool === 0) || permission_prompt
 * Loose sessions have no spool, so for them `my_turn === (status === 'wait')`.
 */

/**
 * @typedef {'claude' | 'codex'} AgentKind
 * @typedef {'busy' | 'wait' | 'unknown'} Status
 */

/**
 * A tmux location. `session` is the tmux session name (e.g.
 * `my-team-demo-team-mvtepzfv`), `window` the window id (`@5`),
 * `pane` the pane id (`%42`).
 * @typedef {{ session: string, window: string, pane: string }} TmuxRef
 */

/**
 * One running agent process. Workers extend this.
 *
 * handle: stable id used by `/switch`.
 *   - tmux pane:    `pane:<session>:<pane>`   e.g. `pane:my-team-x-abc:%42`
 *   - outside tmux: `pid:<pid>`
 *   Workers always use the pane form built from the team's `session_name`
 *   and the manifest `pane_id`, even when dead (tmux === null, pid === 0).
 *
 * @typedef {object} Session
 * @property {string} handle
 * @property {AgentKind} agent
 * @property {number} pid
 * @property {string} cwd
 * @property {string|null} started_at   ISO 8601
 * @property {Status} status
 * @property {boolean} my_turn
 * @property {string|null} since        ISO 8601, when the current status began
 * @property {boolean} permission_prompt  a permission/trust modal is on screen
 * @property {string} title             pane_title or sessions-json `name`
 * @property {TmuxRef|null} tmux
 * @property {string|null} transcript   absolute path of the jsonl transcript
 * @property {string} last_user         last user message text, ≤300 chars, '' if none
 * @property {string} last_assistant    last assistant message text, ≤300 chars, '' if none
 * @property {string|null} term_program  TERM_PROGRAM of the process (outside-tmux focus)
 */

/**
 * Self-reported worker state from `workers/<name>/status.json`. Written by the
 * worker LLM, not by my-team; treat as a hint only.
 * @typedef {{ state: string|null, reason: string|null, updated_at: string|null }} StateFile
 */

/**
 * A my-team worker. `alive` comes from my-team (pane resolved by
 * (session_name, @worker_name)); a dead worker still appears so the user sees
 * the hole in the team.
 *
 * @typedef {Session & {
 *   worker_name: string,
 *   role: 'orchestrator' | 'worker' | null,
 *   description: string,
 *   pane_id: string,
 *   alive: boolean,
 *   spool: number,
 *   inbox: number,
 *   sent_pending: number,
 *   oldest_pending_at: string|null,
 *   state_file: StateFile|null
 * }} Worker
 */

/**
 * @typedef {object} Team
 * @property {string} name
 * @property {string} session_name   tmux session name without the `:0` suffix
 * @property {string|null} started_at
 * @property {boolean} attached      at least one tmux client is attached to the session
 * @property {Worker[]} workers
 */

/**
 * @typedef {object} Board
 * @property {string} at           ISO 8601, when this snapshot was collected
 * @property {Team[]} teams        live teams only (manifest present AND tmux session exists)
 * @property {Session[]} loose     sessions not belonging to a live team
 */

/** @type {Status[]} */
export const STATUSES = ['busy', 'wait', 'unknown'];

/**
 * Build a `/switch` handle.
 * @param {TmuxRef|null} tmux
 * @param {number} pid
 */
export function handleOf(tmux, pid) {
    return tmux ? `pane:${tmux.session}:${tmux.pane}` : `pid:${pid}`;
}

/**
 * Parse the `tmux` field of `~/.claude/sessions/<pid>.json`,
 * e.g. `my-team-demo-team-mvtepzfv:@5.%42`.
 * @param {string|undefined|null} value
 * @returns {TmuxRef|null}
 */
export function parseTmuxTarget(value) {
    if (!value) return null;
    const m = /^(.+):(@\d+)\.(%\d+)$/.exec(value);
    if (!m) return null;
    return { session: m[1], window: m[2], pane: m[3] };
}
