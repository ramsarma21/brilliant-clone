import { useEffect, useState } from 'react'
import { usePlayer } from '../state/PlayerState'
import { cosmeticsOfKind } from '../content/cosmetics'
import { SKILLS } from '../lib/skills'
import type { Cosmetic } from '../types'
import { ATTR_ABBR, POSITION, kitFor, cleatsFor, CardPlayer } from './PlayerAvatar'
import { faceColors } from '../lib/appearance'
import { ClubEmblem } from './ClubEmblem'
import {
  EMBLEM_MOTIFS,
  EMBLEM_SHAPES,
  MAX_CLUB_NAME,
  MOTIF_LABEL,
  SHAPE_LABEL,
  emblemClashName,
} from '../lib/club'
import { shade } from '../lib/playerKit'
import { checkClubNameAppropriate } from '../lib/ai/moderationClient'
import type { EmblemConfig } from '../types'

const RARITY_LABEL: Record<Cosmetic['rarity'], string> = {
  starter: 'Starter',
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
}

const TABS = [
  { id: 'attributes', label: 'Attributes' },
  { id: 'club', label: 'Club' },
  { id: 'jersey', label: 'Jerseys' },
  { id: 'cleats', label: 'Boots' },
] as const
type TabId = (typeof TABS)[number]['id']

// Optional crest-colour overrides (otherwise the badge follows the equipped jersey).
const CREST_COLORS = ['#e02d2d', '#2563eb', '#059669', '#7c3aed', '#f5b81f', '#0d9488', '#ec4899', '#15803d']

function crestAccent(primary: string): string {
  const h = primary.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#1c1606' : '#ffffff'
}

// TEMP (bug-testing): unlock every jersey/boot for free so any option can be tried
// without coins. Set back to false to restore the normal coin economy.
const FREE_TESTING = true

export function PlayerLocker({ displayName, onClose }: { displayName: string; onClose: () => void }) {
  const { profile, overall, buyCosmetic, equip, grantCosmetic, spendPoint, renameClub, setEmblem } = usePlayer()
  const [notice, setNotice] = useState<string | null>(null)
  const [tab, setTab] = useState<TabId>('attributes')
  const [emblemMsg, setEmblemMsg] = useState<string | null>(null)
  // Club-name editing is a local DRAFT committed on blur/Enter, so the appropriateness
  // check runs once per finished edit (not on every keystroke).
  const [nameDraft, setNameDraft] = useState(profile.club.name)
  const [nameMsg, setNameMsg] = useState<string | null>(null)
  const [nameChecking, setNameChecking] = useState(false)

  // Keep the draft in sync if the club name changes elsewhere (e.g. cloud hydration / reset).
  useEffect(() => {
    setNameDraft(profile.club.name)
  }, [profile.club.name])

  // Commit a finished name edit: screen it for appropriateness, then save or revert.
  // The check is dormant until an AI key is configured (moderationClient fails open),
  // so until then names commit immediately exactly as before.
  const commitName = async () => {
    const next = nameDraft.trim()
    if (!next || next === profile.club.name) {
      setNameDraft(profile.club.name)
      setNameMsg(null)
      return
    }
    setNameChecking(true)
    const verdict = await checkClubNameAppropriate(next)
    setNameChecking(false)
    if (!verdict.allowed) {
      setNameMsg(verdict.reason && verdict.reason.length > 0 ? verdict.reason : "That club name isn't allowed — try another.")
      setNameDraft(profile.club.name)
      return
    }
    setNameMsg(null)
    renameClub(next)
  }

  // Apply a crest change ONLY if the result wouldn't be identical to another club's badge.
  // Otherwise surface a "you can't do that" message and leave the crest unchanged.
  const tryEmblem = (patch: Partial<EmblemConfig>) => {
    const kit = kitFor(profile.equipped.jersey)
    const next = { ...profile.club.emblem, ...patch }
    const clash = emblemClashName(next, { primary: kit.primary, secondary: kit.secondary, accent: kit.accent })
    if (clash) {
      setEmblemMsg(`You can't use that crest — it's identical to ${clash}'s. Change the shape, emblem, or colour.`)
      return
    }
    setEmblemMsg(null)
    setEmblem(patch)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const bestSkill = SKILLS.reduce((best, s) =>
    (profile.skills[s.id] ?? 0) > (profile.skills[best.id] ?? 0) ? s : best,
  )
  const position = POSITION[bestSkill.id]

  function onBuy(item: Cosmetic) {
    if (FREE_TESTING) {
      grantCosmetic(item.id)
      setNotice(`${item.name} equipped (free)`)
      return
    }
    const result = buyCosmetic(item.id)
    if (result.ok) {
      equip(item.id)
      setNotice(`${item.name} purchased & equipped`)
    } else if (result.reason === 'insufficient-coins') {
      setNotice(`Not enough coins for ${item.name}`)
    } else if (result.reason === 'already-owned') {
      equip(item.id)
    }
  }

  function renderItem(item: Cosmetic) {
    const owned = profile.inventory.includes(item.id)
    const equipped = profile.equipped[item.kind] === item.id
    const affordable = FREE_TESTING || profile.coins >= item.price
    return (
      <div className={`locker-item${equipped ? ' locker-item--on' : ''}`} key={item.id}>
        <span
          className="locker-item__swatch"
          style={{
            background: `linear-gradient(140deg, ${item.colors.primary}, ${item.colors.secondary})`,
            boxShadow: `inset 0 0 0 2px ${item.colors.accent}`,
          }}
        />
        <span className="locker-item__info">
          <strong>{item.name}</strong>
          <span className={`locker-item__rarity locker-item__rarity--${item.rarity}`}>
            {RARITY_LABEL[item.rarity]}
          </span>
        </span>
        {equipped ? (
          <span className="locker-item__btn locker-item__btn--on">Equipped</span>
        ) : owned ? (
          <button className="locker-item__btn" onClick={() => equip(item.id)}>Equip</button>
        ) : (
          <button
            className="locker-item__btn locker-item__btn--buy"
            disabled={!affordable}
            onClick={() => onBuy(item)}
          >
            {FREE_TESTING ? 'Free' : <><span className="coin-icon" aria-hidden /> {item.price}</>}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="locker-overlay" role="dialog" aria-modal="true" aria-label="Player hub" onClick={onClose}>
      <div className="locker locker--career" onClick={(e) => e.stopPropagation()}>
        <header className="locker__head">
          <div>
            <span className="eyebrow">My Career</span>
            <h2>Player Hub</h2>
          </div>
          <div className="locker__head-right">
            <span className="hud__chip hud__chip--coin"><span className="coin-icon" aria-hidden /> <strong>{profile.coins}</strong></span>
            <button className="locker__close" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </header>

        <div className="career-hub">
          {/* rotatable model stage */}
          <aside className="career-stage">
            <div className="career-stage__glow" aria-hidden />
            <div
              className="career-stage__turn"
              role="img"
              aria-label={`${displayName} player model`}
            >
              <CardPlayer
                jersey={kitFor(profile.equipped.jersey)}
                cleats={cleatsFor(profile.equipped.cleats)}
                face={faceColors(profile.appearance)}
                className="career-stage__avatar"
              />
            </div>

            <div className="career-stage__plate">
              <div className="career-stage__ovr"><b>{overall}</b><span>OVR</span></div>
              <div className="career-stage__id">
                <strong>{displayName.toUpperCase()}</strong>
                <span>{position} · {profile.club.name}</span>
              </div>
            </div>
          </aside>

          {/* tabbed panels */}
          <div className="career-panel">
            <nav className="career-tabs" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  className={`career-tab${tab === t.id ? ' career-tab--on' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </nav>

            <div className="career-panel__body">
              {tab === 'attributes' && (
                <section className="locker__section">
                  <div className="locker__section-head">
                    <h3>Attributes</h3>
                    <span className={`locker__pts${profile.skillPoints > 0 ? ' locker__pts--has' : ''}`}>
                      {profile.skillPoints} skill point{profile.skillPoints === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="locker__attrs">
                    {SKILLS.map((s) => {
                      const rating = profile.skills[s.id] ?? 50
                      const maxed = rating >= 99
                      return (
                        <div className="locker-attr" key={s.id}>
                          <span className="locker-attr__abbr">{ATTR_ABBR[s.id]}</span>
                          <span className="locker-attr__name">{s.name}</span>
                          <span className="locker-attr__val">{rating}</span>
                          <button
                            className="locker-attr__plus"
                            disabled={profile.skillPoints <= 0 || maxed}
                            onClick={() => spendPoint(s.id, 1)}
                            aria-label={`Upgrade ${s.name}`}
                          >
                            +
                          </button>
                        </div>
                      )
                    })}
                  </div>
                  {profile.skillPoints <= 0 && (
                    <p className="locker__hint">Earn skill points in The Quantum League assessment to upgrade attributes.</p>
                  )}
                </section>
              )}

              {tab === 'club' && (() => {
                const kit = kitFor(profile.equipped.jersey)
                const emblem = profile.club.emblem
                const crestPrimary = emblem.primary ?? kit.primary
                return (
                  <section className="locker__section club-edit">
                    <div className="locker__section-head"><h3>Club identity</h3></div>
                    <div className="club-edit__top">
                      <span className="club-edit__preview">
                        <ClubEmblem
                          name={profile.club.name}
                          primary={kit.primary}
                          secondary={kit.secondary}
                          accent={kit.accent}
                          config={emblem}
                          size={96}
                        />
                      </span>
                      <label className="club-edit__name">
                        <span>Club name</span>
                        <input
                          type="text"
                          value={nameDraft}
                          maxLength={MAX_CLUB_NAME}
                          onChange={(e) => { setNameDraft(e.target.value); if (nameMsg) setNameMsg(null) }}
                          onBlur={commitName}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                          disabled={nameChecking}
                          placeholder="Physics FC"
                        />
                      </label>
                    </div>
                    {nameChecking && <p className="locker__hint">Checking name…</p>}
                    {nameMsg && <p className="club-edit__warn">{nameMsg}</p>}

                    <div className="club-edit__group">
                      <span className="club-edit__label">Badge shape</span>
                      <div className="club-edit__chips">
                        {EMBLEM_SHAPES.map((sh) => (
                          <button
                            key={sh}
                            type="button"
                            className={`club-chip${emblem.shape === sh ? ' is-on' : ''}`}
                            onClick={() => tryEmblem({ shape: sh })}
                          >
                            {SHAPE_LABEL[sh]}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="club-edit__group">
                      <span className="club-edit__label">Emblem</span>
                      <div className="club-edit__chips">
                        {EMBLEM_MOTIFS.map((mo) => (
                          <button
                            key={mo}
                            type="button"
                            className={`club-chip${emblem.motif === mo ? ' is-on' : ''}`}
                            onClick={() => tryEmblem({ motif: mo })}
                          >
                            {MOTIF_LABEL[mo]}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="club-edit__group">
                      <span className="club-edit__label">Crest colour</span>
                      <div className="club-edit__swatches">
                        <button
                          type="button"
                          className={`club-swatch club-swatch--kit${emblem.primary ? '' : ' is-on'}`}
                          onClick={() => tryEmblem({ primary: undefined, secondary: undefined, accent: undefined })}
                          title="Match kit"
                        >
                          Kit
                        </button>
                        {CREST_COLORS.map((col) => (
                          <button
                            key={col}
                            type="button"
                            className={`club-swatch${emblem.primary === col ? ' is-on' : ''}`}
                            style={{ background: col }}
                            onClick={() =>
                              tryEmblem({ primary: col, secondary: shade(col, -0.34), accent: crestAccent(col) })
                            }
                            aria-label={`Crest colour ${col}`}
                          />
                        ))}
                      </div>
                    </div>
                    {emblemMsg && <p className="club-edit__warn">{emblemMsg}</p>}
                    {emblem.primary != null && (
                      <p className="locker__hint">Showing crest colour {crestPrimary}. Pick “Kit” to follow your jersey.</p>
                    )}
                  </section>
                )
              })()}

              {tab === 'jersey' && (
                <section className="locker__section">
                  <div className="locker__section-head"><h3>Jerseys</h3></div>
                  <div className="locker__grid">{cosmeticsOfKind('jersey').map(renderItem)}</div>
                </section>
              )}

              {tab === 'cleats' && (
                <section className="locker__section">
                  <div className="locker__section-head"><h3>Boots</h3></div>
                  <div className="locker__grid">{cosmeticsOfKind('cleats').map(renderItem)}</div>
                </section>
              )}
            </div>
          </div>
        </div>

        {notice && <p className="locker__notice" role="status">{notice}</p>}
      </div>
    </div>
  )
}
