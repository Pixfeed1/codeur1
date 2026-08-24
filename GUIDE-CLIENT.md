# ravive - Guide d'utilisation

Application : https://ravive-moi.fr
Administration : https://ravive-moi.fr/admin

---

## 1. Comment ça marche, en résumé

Chaque carte ravive porte une puce NFC contenant une adresse internet unique,
et un code d'activation imprimé dans son packaging.

**L'acheteur** scanne la carte, saisit le code, enregistre un message vocal
(et une photo s'il le souhaite), puis scelle la carte. Le message est alors
lié définitivement à cette carte.

**Le destinataire** scanne la même carte et arrive directement sur le message,
qu'il peut écouter autant de fois qu'il veut, aujourd'hui comme dans dix ans.

Aucune application à installer : tout se passe dans le navigateur du téléphone.

---

## 2. Se connecter à l'administration

Rendez-vous sur https://ravive-moi.fr/admin et saisissez votre identifiant et
votre mot de passe.

Vous y trouverez trois choses : le nombre de cartes créées, en attente et déjà
enregistrées ; un bouton pour générer de nouveaux lots ; et la liste complète
de vos cartes avec leur état.

---

## 3. Produire un lot de cartes

C'est l'opération que vous ferez avant chaque fabrication.

Dans l'administration, indiquez le nombre de cartes souhaité (jusqu'à 1000 à
la fois) et cliquez sur **Générer les cartes**. Un bouton de téléchargement
apparaît : récupérez le fichier, il contient deux colonnes.

| Colonne | À quoi elle sert |
|---|---|
| `url_nfc` | L'adresse à encoder dans la puce NFC de la carte |
| `code_activation` | Le code à imprimer dans le packaging de **cette** carte |

**Le point le plus important de tout ce guide :** chaque code ne fonctionne
qu'avec l'URL qui se trouve sur la même ligne. Une carte dont le packaging
contient le code d'une autre carte sera inutilisable. Transmettez le fichier
tel quel à votre fabricant, sans réordonner les lignes.

Deuxième point important : **les codes ne sont affichés qu'une seule fois**,
au moment de la génération. Ils ne sont conservés nulle part en clair, y
compris chez nous, c'est ce qui garantit que personne ne peut deviner ou
retrouver le code d'une carte. Conservez donc le fichier téléchargé en lieu
sûr jusqu'à la fabrication, puis supprimez-le. Si vous le perdez avant, il
faut regénérer un lot.

---

## 4. Suivre vos cartes

La liste de l'administration indique pour chaque carte :

- **en attente** : la carte est fabriquée mais personne n'a encore enregistré
  de message. C'est l'état normal d'une carte en stock ou en vente.
- **enregistrée** : un message y est scellé. La durée, la présence d'une photo
  et la date apparaissent dans le tableau.

Vous pouvez cliquer sur l'adresse d'une carte pour voir ce que voit son
destinataire.

---

## 5. Ce que vit l'acheteur

1. Il scanne la carte, ou ouvre l'adresse dans son navigateur.
2. Il saisit le code d'activation trouvé dans le packaging.
3. Il enregistre son message (3 minutes maximum) et peut ajouter une photo
   depuis sa galerie ou son appareil photo. L'ordre n'a pas d'importance, et
   la photo reste facultative.
4. Il peut réécouter, recommencer, changer ou retirer la photo autant de fois
   qu'il le souhaite.
5. Quand tout lui convient, il clique sur **Sceller la carte** et confirme.

Après le scellage, plus rien ne peut être modifié : c'est ce qui fait la
valeur du cadeau, le message est définitif. Une confirmation est demandée
avant, pour éviter tout scellage par mégarde.

---

## 6. Ce que vit le destinataire

Il scanne la carte et arrive directement sur l'écran d'écoute, sans code ni
manipulation. Si une photo a été ajoutée, elle s'affiche en grand derrière le
lecteur et devient plus présente pendant la lecture du message.

Le message reste accessible indéfiniment, autant de fois que voulu.

---

## 7. Vos données

Les messages et les photos sont conservés dans le seul but d'être restitués au
destinataire de la carte. Ils ne sont ni analysés, ni transmis à des tiers, ni
utilisés à des fins publicitaires, et l'application n'utilise aucun cookie de
suivi.

Les codes d'activation sont stockés sous forme chiffrée : même en accédant à
la base, il est impossible de les lire. Le nombre de tentatives est limité,
ce qui empêche quiconque de deviner un code au hasard.

Toute l'application fonctionne en HTTPS, ce qui est d'ailleurs une obligation
technique : sans connexion sécurisée, les téléphones refusent l'accès au
microphone.

---

## 8. Ce qui se passe tout seul

Vous n'avez rien à surveiller au quotidien :

- le certificat de sécurité se renouvelle automatiquement ;
- l'application redémarre d'elle-même en cas d'incident, et après un
  redémarrage du serveur ;
- une sauvegarde complète des contenus est effectuée chaque nuit à 3 h, avec
  sept jours d'historique conservés ;
- votre hébergeur réalise en plus ses propres sauvegardes de la machine.

---

## 9. Capacité

Le serveur dispose de 50 Go. Un souvenir complet (message vocal et photo)
occupe environ 1 à 2 Mo, ce qui représente de l'ordre de 25 000 à 40 000
cartes. Si un jour vous approchez de cette limite, l'offre du serveur
s'augmente en quelques clics chez l'hébergeur, sans interruption ni migration.

---

## 10. En cas de souci

**Un acheteur dit que son code ne fonctionne pas.** Vérifiez dans
l'administration que la carte n'est pas déjà à l'état « enregistrée » : dans
ce cas un message y a déjà été scellé. Sinon, il s'agit le plus souvent d'une
confusion entre deux cartes, ou de trop nombreuses tentatives (le déblocage
est automatique au bout de quinze minutes).

**Un acheteur n'arrive pas à enregistrer.** Son navigateur doit être autorisé
à utiliser le microphone : la demande d'autorisation apparaît au premier
enregistrement, et si elle a été refusée, il faut la réactiver dans les
réglages du navigateur. Un rafraîchissement de la page suffit ensuite.

**Le site ne répond pas.** Cela ne devrait pas arriver, l'application
redémarre seule. Si le cas se présentait, contactez-nous.

**Vous avez perdu le fichier des codes d'un lot non fabriqué.** Générez un
nouveau lot : les cartes précédentes resteront simplement inutilisées.

---

## 11. Vos accès

| Quoi | Où |
|---|---|
| Hébergement et nom de domaine | Votre compte EX2 (ex2.com), à votre nom |
| Administration des cartes | https://ravive-moi.fr/admin |
| Adresse de contact du service | ravive.support@gmail.com |

L'hébergement et le domaine vous appartiennent : vous en êtes le titulaire et
vous en gardez la maîtrise complète.

---

## 12. Contact

Développement, support et maintenance : Pixfeed (https://pixfeed.net)

Pour toute question, évolution de l'application ou incident, écrivez-nous.
