<?php

// Page d'accueil : ouverture directe du calculateur (comme l'ancienne route « / »).
header('Location: calculateur/index.php', true, 302);
exit;
