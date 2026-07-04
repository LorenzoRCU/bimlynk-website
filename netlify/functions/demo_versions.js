// Demo version manifest — defines what's included in each demo package.
// Used by demo-send to assemble the email automatically.

module.exports = {
  'lynk-electrical-demo-v1.0': {
    id: 'lynk-electrical-demo-v1.0',
    label: 'LYNK Electrical Demo v1.2',
    description: 'Cable Tray Support, Clearance, Tag Generator (Conduit ID + Cable Tray ID)',
    installer: {
      url: '/downloads/lynk-electrical-demo-v1.0/LYNK_Electrical_Demo_v1.2_Setup.exe',
      filename: 'LYNK_Electrical_Demo_v1.2_Setup.exe'
    },
    families: [
      {
        url: '/downloads/lynk-electrical-demo-v1.0/families/Cable Tray Support__Open Bracket_LYNK.rfa',
        filename: 'Cable Tray Support__Open Bracket_LYNK.rfa'
      },
      {
        url: '/downloads/lynk-electrical-demo-v1.0/families/GEN_GM_Clearence zone_LYNK.rfa',
        filename: 'GEN_GM_Clearence zone_LYNK.rfa'
      },
      {
        url: '/downloads/lynk-electrical-demo-v1.0/families/NLRS_61_E_Cable Tray Support_Console_LYNK.rfa',
        filename: 'NLRS_61_E_Cable Tray Support_Console_LYNK.rfa'
      },
      {
        url: '/downloads/lynk-electrical-demo-v1.0/families/NLRS_61_E_Cable Tray Support_Hanging Rail_LYNK.rfa',
        filename: 'NLRS_61_E_Cable Tray Support_Hanging Rail_LYNK.rfa'
      }
    ],
    // Tools whose manuals to include as PDF
    manuals: [
      'cable_tray_support',
      'cable_tray_clearance',
      'conduit_id',
      'cable_tray_id'
    ]
  }
};
