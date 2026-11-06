interface Props {
  /** Every User in the Room: a Group's Members in join order, or both Users of a Private Room. */
  names: string[];
  onlineList: string[];
  /** The viewer's lowercase username. */
  me: string;
  /** Opens the Private Room with `name`. */
  onOpen: (name: string) => void;
  /** Kicks the Member `name`. Only a Group has this. */
  onKick?: (name: string) => void;
}

/**
 * The column beside a Room: who is in it, and who of them is Online.
 * Only an Online User's name opens a Private Room, because the server refuses one with an Offline User.
 * A Group's offline Members who joined after the viewer have a Kick button; the server enforces the same rule.
 */
export function MemberPanel({ names, onlineList, me, onOpen, onKick }: Props) {
  const isOnline = (name: string) => onlineList.some((user) => user.toLowerCase() === name.toLowerCase());
  const online = names.filter(isOnline);
  const offline = names.filter((name) => !isOnline(name));
  const myPlace = names.findIndex((name) => name.toLowerCase() === me);
  return (
    <aside className="member-panel" aria-label="Users in this Room">
      <section>
        <h2>Online — {online.length}</h2>
        <ul>
          {online.map((name) => (
            <li key={name} className="enter">
              {name.toLowerCase() === me ? (
                <div className="row">
                  <span className="presence" />
                  {name} (you)
                </div>
              ) : (
                <button type="button" className="row row-button" onClick={() => onOpen(name)}>
                  <span className="presence" />
                  {name}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Offline — {offline.length}</h2>
        <ul>
          {/* Never the viewer: they're Online for as long as this page is logged in. */}
          {offline.map((name) => (
            <li key={name} className="row member-offline enter">
              <span className="presence" />
              {name}
              {onKick && myPlace !== -1 && names.indexOf(name) > myPlace && (
                <button type="button" className="member-kick" aria-label={`Kick ${name}`} onClick={() => onKick(name)}>
                  Kick
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
