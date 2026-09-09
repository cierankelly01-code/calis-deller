export type BrowserUser = {id:string;email?:string;role:'staff'|'manager'};
let user: BrowserUser | null = null;
export function setBrowserUser(value:BrowserUser|null) {user=value;}
export function getBrowserUser() {return user;}
export function clearDisplayCache() {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('cd-') || /^sb-.*-auth-token$/.test(key)) localStorage.removeItem(key);
  }
  sessionStorage.removeItem('cd-admin-pin-ok');
}
