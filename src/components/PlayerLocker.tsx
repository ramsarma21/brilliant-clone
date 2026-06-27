import { useEffect, useState } from 'react'
import { usePlayer } from '../state/PlayerState'
import { cosmeticsOfKind } from '../content/cosmetics'
import { SKILLS } from '../lib/skills'
import type { Cosmetic } from '../types'
import { CardPlayer, ATTR_ABBR, POSITION, kitFor, cleatsFor } from './PlayerAvatar'

const RARITY_LABEL: Record<Cosmetic['rarity'], string> = {
  starter: 'Starter',
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
}

export function PlayerLocker({ displayName, onClose }: { displayName: string; onClose: () => void }) {
  const { profile, overall, buyCosmetic, equip, spendPoint } = usePlayer()
  const [notice, setNotice] = useState<string | null>(null)

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
    const affordable = profile.coins >= item.price
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
            <span className="coin-icon" aria-hidden /> {item.price}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="locker-overlay" role="dialog" aria-modal="true" aria-label="Player locker" onClick={onClose}>
      <div className="locker" onClick={(e) => e.stopPropagation()}>
        <header className="locker__head">
          <div>
            <span className="eyebrow">Player Locker</span>
            <h2>Customize your player</h2>
          </div>
          <div className="locker__head-right">
            <span className="hud__chip hud__chip--coin"><span className="coin-icon" aria-hidden /> <strong>{profile.coins}</strong></span>
            <button className="locker__close" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </header>

        <div className="locker__body">
          {/* live preview */}
          <aside className="locker__preview">
            <div className="locker__card">
              <div className="locker__card-ovr"><b>{overall}</b><span>OVR</span></div>
              <div className="locker__card-pos">{position}</div>
              <CardPlayer jersey={kitFor(profile.equipped.jersey)} cleats={cleatsFor(profile.equipped.cleats)} className="locker__avatar" />
              <div className="locker__card-name">{displayName.toUpperCase()}</div>
              <div className="locker__card-club">PHYSICS FC</div>
            </div>
          </aside>

          <div className="locker__panels">
            {/* skill points */}
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

            {/* kit */}
            <section className="locker__section">
              <div className="locker__section-head"><h3>Jerseys</h3></div>
              <div className="locker__grid">{cosmeticsOfKind('jersey').map(renderItem)}</div>
            </section>

            <section className="locker__section">
              <div className="locker__section-head"><h3>Cleats</h3></div>
              <div className="locker__grid">{cosmeticsOfKind('cleats').map(renderItem)}</div>
            </section>
          </div>
        </div>

        {notice && <p className="locker__notice" role="status">{notice}</p>}
      </div>
    </div>
  )
}
