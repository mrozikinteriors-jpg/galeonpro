# Analiza i plan rozwoju aplikacji PD / Zespol Galeon

Data analizy: 2026-07-12

## Adresy aplikacji

- Aplikacja mobilna Zespol: https://mrozikinteriors-jpg.github.io/galeonpro/zespol.html?v=20260712-v11
- Adres glowny repo: https://mrozikinteriors-jpg.github.io/galeonpro/
- Panel/prototyp PD: https://mrozikinteriors-jpg.github.io/galeonpro/galeon-panel.html

Adres glowny zostal ustawiony tak, aby prowadzil do aplikacji mobilnej `zespol.html`.

## Co jest w repo

- Brak frameworka. To statyczna aplikacja PWA w HTML, CSS i JavaScript.
- `zespol.html` jest wlasciwa aplikacja mobilna do pracy brygadzisty z lista pracownikow.
- `galeon-panel.html` jest wiekszym panelem/prototypem PD.
- `sw-zespol.js` obsluguje cache dla aplikacji mobilnej Zespol.
- `manifest-zespol.json` odpowiada za instalacje PWA aplikacji Zespol na telefonie.
- Komunikacja z Airtable odbywa sie bezposrednio z przegladarki przez REST API.
- Token Airtable jest trzymany lokalnie w telefonie w `localStorage`.

## Opinia

Aplikacja ma sens biznesowy, bo rozwiazuje realny problem na hali: obecnosci, jednostka, kabiny, zadania, nadgodziny i szybki zapis do Airtable sa w jednym miejscu. Problem nie lezy w samym pomysle, tylko w tym, ze aplikacja zaczyna miec za duzo odpowiedzialnosci w jednym pliku.

Obecna struktura jest dobra jako szybki prototyp i dziala produkcyjnie, ale nie jest dobra jako dlugoterminowa baza pod rozbudowany dziennik pracy, raporty, Gmail i synchronizacje offline. Nie przebudowywalbym jednak wszystkiego od zera. Najrozsadniejsza droga to przebudowa etapami:

1. Zostawic dzialajacy ekran obecnosci i zapis do Airtable.
2. Wyciagnac logike godzin, odcinkow pracy, walidacji i raportu do osobnych plikow JS.
3. Dopiero potem dodac nowe tabele Airtable i synchronizacje robocza.
4. Na koncu przeniesc raporty i Gmail do backendu/serverless, zeby raport byl powtarzalny i nie zalezal od recznej analizy w Claude.

## Airtable

Airtable jest dobrym wyborem na obecnym etapie, bo znasz to narzedzie, dane sa widoczne i mozna je szybko poprawiac. Dla jednej osoby operujacej aplikacja to jest praktyczne.

Ograniczenia Airtable pojawia sie przy:

- raportach generowanych wedlug stalego standardu,
- synchronizacji offline,
- unikaniu duplikatow,
- historii zmian po zamknieciu dnia,
- integracji Gmail,
- blokowaniu przypadkowej edycji danych zatwierdzonych.

Wniosek: Airtable zostaje jako baza operacyjna, ale raportowanie powinno byc budowane na zatwierdzonym snapshotcie dnia, a nie na luznej analizie aktualnych rekordow.

## Dlaczego timery moga sie blokowac

Skoro dane zapisuja sie poprawnie w Airtable, problem prawdopodobnie nie jest w bazie. Bardziej prawdopodobne przyczyny:

- stan timerow jest trzymany tylko w pamieci ekranu,
- render karty pracownika nadpisuje elementy UI w trakcie pracy,
- dlugie zapisy do Airtable blokujace przyciski i stan interfejsu,
- service worker albo cache pokazuje starszy plik,
- brak jednej warstwy prawdy dla czasu pracy.

Docelowo timer nie powinien byc kluczowym zrodlem prawdy. Zrodlem prawdy powinny byc odcinki pracy: `od`, `do`, `przerwa`, `zadanie`, `wynik`, `problem`. Timer moze tylko pomagac uzupelniac te pola.

## Raporty

Raporty nie powinny byc tworzone za kazdym razem od nowa przez AI na podstawie surowych danych. To powoduje rozny styl i ryzyko przeklaman.

Lepszy proces:

1. Aplikacja zamyka dzien i tworzy snapshot danych.
2. Snapshot zawiera obecnosci, godziny, nadgodziny, zadania, postoje, problemy i plan na kolejny dzien.
3. Generator raportu tworzy zawsze ten sam uklad tekstu.
4. AI moze co najwyzej wygladzic styl, ale nie powinna samodzielnie wybierac faktow.
5. Uzytkownik widzi podglad, moze edytowac i dopiero potem tworzy szkic Gmail.

## Poranny raport

Poranny raport powinien byc oddzielnym widokiem:

- lista obecnosci z poprzedniego dnia,
- suma godzin i nadgodzin per pracownik,
- zadania przypisane do nadgodzin,
- braki w danych,
- pracownicy bez przypisanych zadan do nadgodzin.

To mozna wygenerowac bez przebudowy calego systemu, jesli dane w `Dziennik` sa kompletne i konsekwentne.

## Kolejne etapy

### Etap 1: stabilizacja

- utrzymac `zespol.html` jako glowna aplikacje,
- usunac problem starej wersji przez wersjonowanie `sw-zespol.js` i manifestu,
- pokazac numer wersji w topbarze,
- uporzadkowac adres startowy PWA.

### Etap 2: dziennik pracownika

- klikniecie karty pracownika otwiera szczegoly pracownika,
- dodac czas pracy od-do, przerwe i automatyczne liczenie godzin,
- dodac odcinki pracy w ciagu dnia,
- dodac problemy i postoje,
- walidowac nakladajace sie godziny i braki w opisach.

### Etap 3: Airtable

- zostawic obecny `Dziennik` jako obsade dnia,
- dodac `Dni robocze`,
- dodac `Odcinki pracy`,
- dodac `Zdarzenia`,
- opcjonalnie dodac `Raporty dzienne`.

### Etap 4: raporty

- generator raportu dziennego w aplikacji,
- kopiowanie raportu do schowka,
- staly szablon maila,
- pozniej szkic Gmail przez backend/OAuth.

## Decyzja architektoniczna

Nie rekomenduje teraz przepisywania aplikacji od zera. Rekomenduje przebudowe modulowa: najpierw stabilizacja i raporty, potem rozbijanie monolitu. To zmniejsza ryzyko utraty tego, co juz dziala w Airtable.
