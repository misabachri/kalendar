# Měsíční přehled sloužících lékařů

Webová aplikace pro generování měsíčního rozpisu služeb 10 lékařů.

## Spuštění

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
npm run preview
```

## iOS (Apple) build

Projekt je pripraveny pro iOS pres Capacitor.

1. Nainstalujte nove zavislosti:

```bash
npm install
```

2. Vytvorte iOS projekt (jen poprve):

```bash
npm run ios:init
```

3. Synchronizujte web build do iOS projektu:

```bash
npm run ios:sync
```

4. Otevrete projekt v Xcode:

```bash
npm run ios:open
```

V Xcode pak vyberte simulator nebo fyzicky iPhone a dejte `Run`.

## Použitý stack

- React + TypeScript + Vite
- Tailwind CSS
- LocalStorage pro perzistenci
- Tiskové A4 CSS
- CSV export

## Logika omezení

### Hard constraints

1. Přesně jeden lékař na den.
2. `Nemůže` je absolutní zákaz.
3. Po službě je povinný den volna (D a D+1 nelze stejný lékař).
4. Přesah minulého měsíce: zadává se, kdo sloužil poslední 2 dny minulého měsíce; lékař z posledního dne nesmí den 1.
5. Primář a zástupce:
   - nikdy Pá/So/Ne
   - primář maximálně 1 služba za měsíc
   - zástupce maximálně 2 služby za měsíc
6. Zamčené služby jsou tvrdé pravidlo; konflikty se hlásí.
7. U každého běžného lékaře lze zadat maximální počet služeb za měsíc.
8. U každého lékaře lze zadat požadovaný počet služeb; solver je nejdřív zkusí splnit přesně.
9. Víkendový blok `Pá–Ne` se počítá jako jeden celek; každý lékař může mít maximálně 2 takové bloky za měsíc.
10. Atestovaní lékaři jsou #1–#5 a musí pokrýt všechny úterky a čtvrtky.

### Cíle a fallback

- První průchod hledá řešení, které přesně splní zadané požadované počty služeb.
- Pokud to matematicky nejde (kvůli hard constraints), použije se fallback, který hledá realizovatelný rozpis s minimální odchylkou od cílů.

### Soft constraints (priorita)

1. `Chce` se bere jako tvrdý požadavek dne: pokud je na dni alespoň jedno `Chce`, službu musí dostat lékař s nejvyšší prioritou podle pořadí (nejnižší číslo). `Nechce` je penalizace.
   Pokud má lékař více dní `Chce` než svůj požadovaný počet služeb, vynucení `Chce` se u něj uplatní jen do výše cíle; další `Chce` jsou už jen preference.
2. Hlavní preference je držet požadované počty služeb u jednotlivých lékařů.
3. Penalizace vzoru obden (D a D+2 stejný lékař).
4. Preferovat, aby lékař nesloužil den před svou ambulancí (měkké pravidlo).
5. Vyrovnávání víkendové zátěže (Pá/So/Ne).

## Algoritmus

Použit je backtracking s forward checking:

- Volí se nejdřív nejvíce omezený den (nejméně kandidátů).
- Kandidáti se řadí podle skóre soft constraints.
- Po každém přiřazení se ověří, že každý zbývající den má alespoň jednoho možného kandidáta.
- Volitelný `seed` mění tie-break pořadí kandidátů pro alternativní varianty.

Pokud nelze plán sestavit ani ve fallback režimu, aplikace zobrazí konfliktní report.

## UI poznámky

- Týden začíná pondělím (Po–Ne) ve formuláři i v kalendářovém výstupu.
- Dostupnost je řešena po jednom aktivním lékaři v měsíční mřížce bez horizontálního scrollu.
- Zamykání je přímo v generovaném kalendáři (`Zamknout`/`Odemknout` pro konkrétní den).
- Karta lékaře obsahuje `Požadovaný počet služeb`; ve statistikách se zobrazuje `skutečnost / cíl`.

## Poznámka k perzistenci

Celý formulář (měsíc/rok, jména, limity, cílové počty, preference, zámky, poslední 2 dny minulého měsíce, seed) se ukládá do `localStorage`.
