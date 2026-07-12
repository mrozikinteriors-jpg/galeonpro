# Zasady pracy w repo

## Kontekst

To repo zawiera statyczna aplikacje PWA dla procesu PD / Zespol Galeon.

Najwazniejszy ekran mobilny brygadzisty to `zespol.html`.

## Zasady zmian

- Nie przepisywac aplikacji od zera bez osobnej decyzji.
- Nie usuwac historii Airtable.
- Nie zmieniac nazw istniejacych pol Airtable bez potwierdzenia.
- Zachowac dzialajacy przeplyw: data, jednostka, obecnosci, zadania, zapis dnia.
- Nowe funkcje dodawac etapami i utrzymywac zgodnosc z ciemnym mobile UI.
- Przy zmianach PWA podbijac wersje `sw-zespol.js` i cache-busting w manifestach/skryptach.

## Kierunek

Logike godzin, odcinkow pracy, walidacji i raportow nalezy docelowo wyniesc z `zespol.html` do osobnych modulow JS. Airtable moze zostac baza operacyjna, ale raporty powinny powstawac z zatwierdzonego snapshotu dnia.
