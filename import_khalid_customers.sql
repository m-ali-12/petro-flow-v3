DO $$
DECLARE
  target_user_id UUID;
  target_company_id UUID;
BEGIN
  -- 1. Find user by email to get their user_id and company_id
  SELECT user_id, company_id INTO target_user_id, target_company_id
  FROM public.user_profiles
  WHERE email = 'u0692906@gmail.com'
  LIMIT 1;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'User u0692906@gmail.com not found in user_profiles!';
  END IF;

  -- 2. Insert records safely with all NOT NULL columns satisfied
  INSERT INTO public.customers (
    sr_no, name, category, balance, is_company, user_id, company_id, 
    account_type, credit_limit, initial_credit, is_expense_also
  ) 
  VALUES 
    -- BANKS & INTERNAL ACCOUNTS (Categorized as Owner)
    (1, 'Bank Alflah (K&S)', 'Owner', 0, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (2, 'Bank ABL khata (K&S)', 'Owner', 0, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (3, 'Bank Alfah CC (K&S)', 'Owner', 0, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (4, 'Fasil Bank (Umer Khalid)', 'Owner', 0, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (6, 'Tawaza, Mutafirk Khata', 'Owner', 321823, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (8, 'Akrajat Mutafarik (Dir Exp)', 'Owner', 238595, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (11, 'Mutafarik Kharcha Ghar H.K', 'Owner', 113558, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (12, 'Mustarka Khata U.K', 'Owner', 102686, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (15, 'Capital Rice H.k.(P+L)', 'Owner', 48549349, false, target_user_id, target_company_id, 'regular', 0, 0, false),
    (87, 'Mustarka Staff (adv+c)kam (old B)', 'Owner', 24612, false, target_user_id, target_company_id, 'regular', 0, 0, false),

    -- GOVERNMENT & CORPORATE OFFICES (Categorized as Company, is_company = true)
    (21, 'Dir (Live Stock)', 'Company', 412900, true, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (22, 'D.Dir (Live Stock)', 'Company', 799949, true, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (23, 'A.D.I.O (Live Stock)', 'Company', 448282, true, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (24, 'A.D.L (Live Stock)', 'Company', 122557, true, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (25, 'D.H.O oFFICE', 'Company', 4435817, true, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (26, 'Depty DY. D.H.O oFFICE', 'Company', 0, true, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (28, '(1)C.E.O (h) OFFICE', 'Company', 542673, true, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (29, '(2)C.E.O (h) Office', 'Company', 669558, true, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (30, 'D.E.O (W) Office.41', 'Company', 64530, true, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (31, 'DY.DEO (W).(32) Office', 'Company', 124851, true, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (32, 'P.H.A oFFICE', 'Company', 1116262, true, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (33, 'A.C Office', 'Company', 473188, true, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (34, 'C.T,D oFFICE', 'Company', 9056347, true, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (35, 'Dir Agri (Muhammad Ashfaq)', 'Company', 224114, true, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (36, 'ADC agriculture (Tariq)', 'Company', 0, true, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (37, 'MoonStar Taransport Company', 'Company', 0, true, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (39, 'D.M.O Office', 'Company', 141636, true, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (40, 'DQCB Health Office (H)', 'Company', 412014.03, true, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (41, 'DIR+ETO Office', 'Company', 64969, true, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (46, 'Tevta College (w)', 'Company', 100830, true, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (47, 'E.2.E Petroleum Service', 'Company', 189510, true, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (52, 'Alfazal Construction Company', 'Company', 49394, true, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (53, 'D.H.D.C(h) oFFICE', 'Company', 8498, true, target_user_id, target_company_id, 'regular', 0, 0, false), 

    -- REGULAR CUSTOMERS / OTHERS (Categorized as Regular)
    (5, 'Karaya Gari', 'Regular', 127460, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (7, 'Petrol Khata (Khalid & Sons)', 'Regular', 67807, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (9, 'Leas + Access Khata', 'Regular', 201405, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (10, 'Credit Fuel Finance (C.F-GO)', 'Regular', 394204, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (13, 'Sale, Mobilil, Filter', 'Regular', 371729, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (14, 'khared M.Oil (GO, Shahid)', 'Regular', 0, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (16, 'Daily Dasti Udhar Khata (P.D)', 'Regular', 63944, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (17, 'S.E Kanal  Office', 'Regular', 1603215, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (18, 'S.E Kanal  Office', 'Regular', 139508, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (19, 'S.E Kanal  Office', 'Regular', 108305, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (20, 'S.D.O (|||) Kanal', 'Regular', 126703, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (27, 'Kachi Parchi (DHO) Wahab + Arshad', 'Regular', 0, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (38, 'Sheikh Ahmad (colony devloper)', 'Regular', 52199.98, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (42, 'Raouf Drg Sahiwal', 'Regular', 177244, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (43, 'Kashif Saif', 'Regular', 96873, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (44, 'Muhammad Faheem Arshad (chacha gormay)', 'Regular', 145857, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (45, 'Royal Archad Sahiwal', 'Regular', 273644, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (48, 'Rana Muzamil (Mamu Caneda)', 'Regular', 143469, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (49, 'Sheikh Khalid (sabzi Mendi)', 'Regular', 16570, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (50, 'Aleem Zahoor', 'Regular', 125000, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (51, 'Nadeem Zafar (riksha)', 'Regular', 22500, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (54, 'Queem Hospital (generator)', 'Regular', 653578, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (55, 'Asghar Malik Shop', 'Regular', 0, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (56, 'Malik Rafeeq Chiken (new)', 'Regular', 22800, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (57, 'Petrol (Nadeem-Faizan-Asif)', 'Regular', 52000, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (58, 'Desil ABL (goriChock)', 'Regular', 0, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (59, 'Sajad Shah (H.k) (old B)', 'Regular', 66532, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (60, 'Tariq Cattrig', 'Regular', 85330, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (61, 'Trade Discount (P.D Instiv)', 'Regular', 0, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (62, 'Khared (p+d) (online O.P)', 'Regular', 0, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (63, 'Shaffeq Bhola (AminaCity)', 'Regular', 96375, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (64, 'Shani (Iftaykhar GO)', 'Regular', 11843, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (65, 'Mehkama Sabziyat (Agriculture)', 'Regular', 0, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (66, 'Mehkama Batul Mal (Welfare Society)', 'Regular', 0, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (67, 'Women Hostel (oldage)', 'Regular', 0, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (68, 'Rana Arif (Good T)', 'Regular', 108000, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    
    -- STAFF ADVANCES & PAY ACCOUNTS
    (69, 'ADV+Pay (Ch Nadeen)', 'Regular', 30100, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (70, 'ADV+Pay (Rana Faizan)', 'Regular', 8000, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (71, 'ADV+Pay (Asif Ali)', 'Regular', 3000, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (72, 'ADV+Pay (Nazeer Ahmad)', 'Regular', 8000, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (73, 'ADV+Pay (Imran.93)', 'Regular', 52000, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (74, 'ADV+Pay (WajehiaUdeen)', 'Regular', 14100, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (75, 'ADV+Pay (Zameer Hussain)', 'Regular', 8567, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (76, 'ADV+Pay (Amir Shahzad)', 'Regular', 0, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (77, 'ADV+Pay (FasilUlRehman)', 'Regular', 2400, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (78, 'ADV+Pay (Dawood Maseh)', 'Regular', 2430, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (79, 'ADV+Pay (SaifAli)', 'Regular', 10400, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (80, 'ADV+Pay (Imran BhutoNagar)', 'Regular', 8500, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (81, 'ADV+Pay (Safdar Ali)', 'Regular', 0, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (82, 'ADV+Pay (Amir Maseei)', 'Regular', 7300, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (83, 'ADV+Pay (Rozi khan)', 'Regular', 0, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (84, 'ADV+Pay (Qari Shafeeq)', 'Regular', 0, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (85, 'ADV+Pay (Raka Maseei)', 'Regular', 72580, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (86, 'ADV+Pay (Watu Machanic)', 'Regular', 5000, false, target_user_id, target_company_id, 'regular', 0, 0, false), 

    -- BIG PREVIOUS BILLS (Also Regular)
    (88, 'TotalBill (h) CEO (Old Baqaya 487)', 'Regular', 252682, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (89, 'TotalBill DHO (oldBaqaya 486)', 'Regular', 5600000, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (90, 'Tariq Cattrig (papu) (oldBaqaya 175)', 'Regular', 26030, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (91, 'TotalBill DPO (Old Baqaya 145)', 'Regular', 3266281, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (92, 'TotalBill TPO (Old Baqaya 365)', 'Regular', 0, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (93, 'TotalBill RPO (Old Baqaya 146)', 'Regular', 917032, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (94, 'Kachi Parchi DPO (old Baqaya 486)', 'Regular', 1301162, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (95, 'Kachi Parchi (khalid Ameen)', 'Regular', 1300748, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (96, 'TotalBill DEO (m) (Old Baqaya 93)', 'Regular', 10540, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (97, 'Iftaykhar Hussain Batla (oldBaqaya 93)', 'Regular', 238000, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (98, 'Hamza Malik (old baqaya 240)', 'Regular', 39220, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (99, 'Malik Rafeeq Chiken (old Baqaya 76)', 'Regular', 81958, false, target_user_id, target_company_id, 'regular', 0, 0, false), 
    (100, 'Kachi Parchi AntiCruption', 'Regular', 113013, false, target_user_id, target_company_id, 'regular', 0, 0, false)

  ON CONFLICT DO NOTHING;
END $$;
